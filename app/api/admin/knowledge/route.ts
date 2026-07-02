import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import { isSafeKnowledgeFilename } from "@/lib/utils/safe-filename";
import { errorDetails } from "@/lib/utils/error-response";

/**
 * Trigger a full re-vectorization by calling the internal /api/admin/vectorize
 * endpoint. `fetch` does not throw on 4xx/5xx, so we must inspect the response
 * and log failures explicitly — otherwise a stale vector index would go
 * unnoticed while the caller still reports success.
 */
async function triggerVectorization(request: NextRequest): Promise<void> {
  try {
    // Use the same token pattern as vectorize endpoint
    const adminToken = process.env.ADMIN_VECTORIZE_TOKEN;

    if (!adminToken) {
      console.warn("ADMIN_VECTORIZE_TOKEN not configured, skipping vectorization");
      return;
    }

    const vectorizeUrl = new URL('/api/admin/vectorize', request.url);

    const res = await fetch(vectorizeUrl.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`
      }
    });

    if (!res.ok) {
      let body = '';
      try {
        body = await res.text();
      } catch {
        // ignore body read errors
      }
      console.error(
        `Vectorization trigger failed with status ${res.status}${body ? `: ${body}` : ''}`
      );
    }
  } catch (vectorError) {
    console.error("Error triggering vectorization:", vectorError);
    // Continue anyway - vectorization can be done manually
  }
}

export async function GET(request: NextRequest) {
  try {
    // Check admin permissions
    const authResult = await checkAdminPermissions(request);
    if (!authResult.success) {
      return NextResponse.json({ error: authResult.error }, { status: 401 });
    }

    // Get Cloudflare bindings
    const { env } = await getCloudflareContext({ async: true });
    const MEDIA = (env as any).MEDIA;
    
    if (!MEDIA) {
      return NextResponse.json({ error: "R2 bucket not configured" }, { status: 500 });
    }

    // List all objects in the knowledge_md directory
    console.log("Listing R2 objects with prefix knowledge_md/");
    const objects = await MEDIA.list({
      prefix: "knowledge_md/"
    });

    console.log("Found objects:", objects.objects?.length || 0);

    if (!objects.objects || objects.objects.length === 0) {
      return NextResponse.json([]);
    }

    const articles = await Promise.all(
      objects.objects
        .filter((obj: any) => obj.key.endsWith('.md'))
        .map(async (obj: any) => {
          try {
            // Get the file content to extract title
            const file = await MEDIA.get(obj.key);
            const content = file ? await file.text() : "";
            
            // Extract title from markdown (first # heading or filename)
            const titleMatch = content.match(/^#\s+(.+)$/m);
            const title = titleMatch?.[1] || obj.key.split('/').pop()?.replace('.md', '') || 'Untitled';
            
            // For existing articles without metadata, assume they're vectorized
            // New articles will have explicit vectorized: 'false' metadata
            const hasMetadata = obj.customMetadata && Object.keys(obj.customMetadata).length > 0;
            const isVectorized = hasMetadata 
              ? obj.customMetadata?.vectorized === 'true' 
              : true; // Assume existing articles are vectorized
            
            return {
              filename: obj.key.split('/').pop() || '',
              title: title,
              content: content,
              lastModified: obj.uploaded?.toISOString() || new Date().toISOString(),
              size: obj.size || 0,
              isVectorized: isVectorized
            };
          } catch (error) {
            console.error(`Error processing ${obj.key}:`, error);
            return {
              filename: obj.key.split('/').pop() || '',
              title: obj.key.split('/').pop()?.replace('.md', '') || 'Untitled',
              content: '',
              lastModified: obj.uploaded?.toISOString() || new Date().toISOString(),
              size: obj.size || 0,
              isVectorized: false
            };
          }
        })
    );

    return NextResponse.json(articles);

  } catch (error) {
    console.error("Error fetching knowledge articles:", error);
    console.error("Error details:", error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      {
        error: "Failed to fetch knowledge articles",
        details: errorDetails(error)
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Check admin permissions
    const authResult = await checkAdminPermissions(request);
    if (!authResult.success) {
      return NextResponse.json({ error: authResult.error }, { status: 401 });
    }

    // Get Cloudflare bindings
    const { env } = await getCloudflareContext({ async: true });
    const MEDIA = (env as any).MEDIA;
    
    if (!MEDIA) {
      return NextResponse.json({ error: "R2 bucket not configured" }, { status: 500 });
    }

    const body: any = await request.json();
    const { filename, title, content } = body;

    if (!filename || !content) {
      return NextResponse.json({ error: "Filename and content are required" }, { status: 400 });
    }

    if (!isSafeKnowledgeFilename(filename)) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    // Trim surrounding whitespace so it can't slip into the stored R2 key
    const safe = filename.trim();

    // Ensure filename ends with .md
    const mdFilename = safe.endsWith('.md') ? safe : `${safe}.md`;
    const key = `knowledge_md/${mdFilename}`;

    // Add title as first heading if not present
    let finalContent = content;
    if (!content.startsWith('#') && title) {
      finalContent = `# ${title}\n\n${content}`;
    }

    // Upload to R2
    await MEDIA.put(key, finalContent, {
      httpMetadata: {
        contentType: 'text/markdown'
      },
      customMetadata: {
        title: title || '',
        uploadedBy: 'admin',
        uploadedAt: new Date().toISOString(),
        vectorized: 'false' // Will be updated to 'true' after vectorization
      }
    });

    // Trigger vectorization
    await triggerVectorization(request);

    return NextResponse.json({
      success: true,
      filename: mdFilename,
      message: "Article saved and vectorization triggered" 
    });

  } catch (error) {
    console.error("Error saving knowledge article:", error);
    return NextResponse.json(
      { error: "Failed to save knowledge article" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Check admin permissions
    const authResult = await checkAdminPermissions(request);
    if (!authResult.success) {
      return NextResponse.json({ error: authResult.error }, { status: 401 });
    }

    // Get Cloudflare bindings
    const { env } = await getCloudflareContext({ async: true });
    const MEDIA = (env as any).MEDIA;
    
    if (!MEDIA) {
      return NextResponse.json({ error: "R2 bucket not configured" }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const filename = searchParams.get('filename');

    if (!filename) {
      return NextResponse.json({ error: "Filename is required" }, { status: 400 });
    }

    if (!isSafeKnowledgeFilename(filename)) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    // Trim surrounding whitespace so it can't slip into the stored R2 key
    const safe = filename.trim();
    const key = `knowledge_md/${safe}`;

    // Delete from R2
    await MEDIA.delete(key);

    // Trigger vectorization to update index
    await triggerVectorization(request);

    return NextResponse.json({
      success: true, 
      message: "Article deleted and vectorization triggered" 
    });

  } catch (error) {
    console.error("Error deleting knowledge article:", error);
    return NextResponse.json(
      { error: "Failed to delete knowledge article" },
      { status: 500 }
    );
  }
}