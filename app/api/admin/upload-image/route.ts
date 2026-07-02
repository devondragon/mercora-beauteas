import { NextRequest, NextResponse } from "next/server";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import { uploadToR2, generateR2Path, R2_FOLDERS } from "@/lib/utils/r2";
import { EXT_BY_MIME, matchesImageSignature } from "@/lib/utils/image-signature";

/**
 * POST /api/admin/upload-image
 * 
 * Uploads images to Cloudflare R2 bucket for products/categories.
 * Handles file validation, path generation, and R2 storage.
 */
export async function POST(request: NextRequest) {
  try {
    // Check admin permissions
    const permissionCheck = await checkAdminPermissions(request);
    if (!permissionCheck.success) {
      return NextResponse.json(
        { error: permissionCheck.error || "Unauthorized" },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const folder = formData.get("folder") as string; // "products" or "categories"
    const filename = formData.get("filename") as string;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    const validFolders = [R2_FOLDERS.PRODUCTS, R2_FOLDERS.CATEGORIES];
    if (!folder || !validFolders.includes(folder as any)) {
      return NextResponse.json(
        { error: `Invalid folder. Must be one of: ${validFolders.join(', ')}` },
        { status: 400 }
      );
    }

    if (!filename) {
      return NextResponse.json(
        { error: "No filename provided" },
        { status: 400 }
      );
    }

    // Validate file type against the MIME allowlist (file.type is client-supplied)
    const fileExtension = EXT_BY_MIME[file.type];
    if (!fileExtension) {
      return NextResponse.json(
        { error: "Invalid file type. Only JPEG, PNG, and WebP are allowed." },
        { status: 400 }
      );
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB." },
        { status: 400 }
      );
    }

    // Convert file to array buffer
    const arrayBuffer = await file.arrayBuffer();

    // Verify the file's actual bytes match the declared MIME type (magic-byte
    // check) — file.type alone is attacker-controlled and cannot be trusted.
    if (!matchesImageSignature(new Uint8Array(arrayBuffer), file.type)) {
      return NextResponse.json(
        { error: "File content does not match the declared image type." },
        { status: 400 }
      );
    }

    // Generate R2 path. The extension is derived from the validated MIME type
    // above, never from the client-supplied file.name.
    const fullFilename = `${filename}.${fileExtension}`;
    const r2Path = generateR2Path(folder, fullFilename);

    // Normalize the non-standard "image/jpg" alias to the standard
    // "image/jpeg" before it's stored as the object's Content-Type, so
    // served objects always carry a standard image content-type.
    const storedContentType = file.type === "image/jpg" ? "image/jpeg" : file.type;

    // Get R2 bucket from environment
    const env = process.env as any;
    const bucket = env.MEDIA as R2Bucket;
    
    if (!bucket) {
      return NextResponse.json(
        { error: "R2 bucket not configured" },
        { status: 500 }
      );
    }

    // Upload to R2 using consolidated utility. contentType comes from the
    // validated file.type (normalized above) — never re-derived from the filename.
    await uploadToR2(bucket, r2Path, arrayBuffer, {
      contentType: storedContentType,
      customMetadata: {
        originalName: file.name,
        folder: folder,
        uploadType: 'admin-image'
      }
    });

    // Generate the path format for database storage
    const storedPath = `/${r2Path}`;

    return NextResponse.json({
      success: true,
      path: storedPath, // This gets saved in database and used with image-loader.ts
      filename: `${filename}.${fileExtension}`,
      size: file.size,
      type: file.type
    });

  } catch (error) {
    console.error("Error uploading image:", error);
    return NextResponse.json(
      { error: "Failed to upload image" },
      { status: 500 }
    );
  }
}