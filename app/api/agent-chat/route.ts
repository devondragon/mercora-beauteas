/**
 * === Agent Chat API ===
 *
 * This endpoint powers the Chai AI assistant - BeauTeas' warm, bubbly beauty bestie that
 * provides intelligent product recommendations and skincare/glow advice using Cloudflare AI and vectorized search.
 *
 * === Core Features ===
 * - Conversational AI powered by @cf/openai/gpt-oss-20b
 * - Vectorized product search using BGE embeddings
 * - Anti-hallucination system to prevent fake product recommendations
 * - Personality system with random flair and easter eggs
 * - Context-aware responses based on conversation history
 *
 * === Request Body ===
 * ```json
 * {
 *   "question": "Which tea helps with breakouts?",
 *   "userName": "John", // Optional, defaults to "Guest"
 *   "history": [...] // Optional conversation history
 * }
 * ```
 *
 * === Response Format ===
 * ```json
 * {
 *   "answer": "AI response text",
 *   "productIds": [1, 2, 3], // IDs of recommended products
 *   "products": [...], // Full product objects
 *   "history": [...], // Updated conversation history
 *   "userId": "clerk_user_id"
 * }
 * ```
 *
 * === AI Personality ===
 * - **Chai**: Warm, bubbly beauty bestie for skincare-from-within
 * - **Anti-Hallucination**: Strict rules prevent fake product recommendations
 * - **Flair System**: 30% chance of adding personality quirks to responses
 * - **Easter Eggs**: Special responses for brewing-ritual and unicorn mentions
 *
 * === Technical Stack ===
 * - **AI Model**: @cf/openai/gpt-oss-20b (temperature: 0.3)
 * - **Embeddings**: @cf/baai/bge-base-en-v1.5 for vectorized search
 * - **Database**: D1 with Drizzle ORM for product data
 * - **Auth**: Clerk for user authentication
 * - **Search**: Cloudflare Vectorize for semantic product matching
 *
 * === Security ===
 * - Protected by Clerk authentication
 * - Input validation and sanitization
 * - Rate limiting via Cloudflare Workers
 * - Strict anti-hallucination prompts
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDbAsync } from "@/lib/db";
import { products, deserializeProduct, product_variants } from "@/lib/db/schema/products";
import { inArray, eq } from "drizzle-orm";
import type { Product } from "@/lib/types";
import { runAI, getCurrentEmbeddingModel, extractAIResponse } from "@/lib/ai/config";

/**
 * Handles chat interactions with the Chai AI assistant
 * 
 * @param req - Next.js request object containing question, userName, and history
 * @returns JSON response with AI answer, recommended products, and updated history
 */
export async function POST(req: NextRequest) {
  try {
    // Parse and validate request body
    const body: { 
      question: string; 
      userName?: string; 
      userContext?: string;
      orders?: any[];
      history?: any[] 
    } = await req.json();
    const { userId } = await auth();
    const { question, userName = "Guest", userContext = "", orders = [], history = [] } = body;

    // Extract Cloudflare location data from request headers
    const requestLocation = {
      country: req.headers.get('CF-IPCountry') || undefined,
      city: req.headers.get('CF-IPCity') || undefined,
      region: req.headers.get('CF-Region') || undefined, 
      timezone: req.headers.get('CF-Timezone') || undefined,
      continent: req.headers.get('CF-IPContinent') || undefined,
      latitude: req.headers.get('CF-IPLatitude') || undefined,
      longitude: req.headers.get('CF-IPLongitude') || undefined,
    };

    if (!question) {
      return NextResponse.json({ error: "Missing question" }, { status: 400 });
    }

    // === VECTORIZED SEARCH PHASE ===
    // Use Cloudflare Vectorize to find relevant products and knowledge base content
    // This provides context for the AI to make accurate recommendations
    let contextSnippets = "";
    let productIds: string[] = [];
    let vectorResults: any = null;

    try {
      // Access Cloudflare Worker bindings for AI and Vectorize
      const { env } = await getCloudflareContext({ async: true });
      const ai = (env as any).AI;
      const vectorize = (env as any).VECTORIZE;

      if (ai && vectorize) {
        // Step 1: Convert user question to vector using same model as indexed content
        // This ensures semantic similarity matching works correctly
        const questionEmbedding = await ai.run(getCurrentEmbeddingModel(), {
          text: question,
        });

        // Step 2: Search vectorized index with timeout protection
        // Use Promise.race to implement timeout
        const vectorSearchPromise = vectorize.query(questionEmbedding.data[0], {
          topK: 7, // Get top 7 matches
          returnMetadata: true, // Include text snippets and product IDs
        });
        
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Vectorize query timeout after 10 seconds')), 10000)
        );
        
        vectorResults = await Promise.race([vectorSearchPromise, timeoutPromise]);

        if (vectorResults && vectorResults.matches) {
          // Extract text snippets to provide context to the AI
          contextSnippets = vectorResults.matches
            .map((match: any) => match.metadata?.text || match.id)
            .join("\n\n");

          // Extract product IDs for fetching full product data later
          productIds = vectorResults.matches
            .map((match: any) => match.metadata?.productId)
            .filter((id: any) => id !== undefined && id !== null && id !== "");
        }
      } else {
        console.warn("Vectorize or AI binding not available");
      }
    } catch (vectorError) {
      console.error("Vectorize query error:", vectorError);
      // Continue without vector context if Vectorize fails
    }

    // Easter egg: Chai's Signature Brewing Ritual
    if (/(secret|signature)\s+(brewing\s+)?(ritual|recipe|blend)/i.test(question)) {
      const easterEgg = `Eee, the secret's out${
        userName !== "Guest" ? `, ${userName}` : ""
      }! Chai's Signature Brewing Ritual 💕:
        1. Fresh water just off the boil—not scorching, we're being gentle with our botanicals.
        2. Steep a full five minutes. Good things take a little time (and so does your glow ✨).
        3. Skip the milk and let those pretty flowers shine.
        Bonus: take one slow, cozy breath over the cup before your first sip. That's the self-care magic.`;

      return NextResponse.json({
        answer: easterEgg,
        productIds: [],
        history: [
          ...history,
          {
            role: "user",
            content: question,
            created_at: new Date().toISOString(),
          },
          {
            role: "assistant",
            content: easterEgg,
            created_at: new Date().toISOString(),
          },
        ],
        userId,
      });
    }

    // Build the conversation history for context - increased due to higher token limit
    const recentMessages = history.slice(-12); // Keep last 12 messages for better context retention

    // Enhanced selective recommendation system prompt
    const systemPrompt = `You are Chai, BeauTeas' warm and bubbly beauty bestie — obsessed with skincare, glow, and helping people feel pretty from the inside out. You really know your organic botanicals and what they do for skin, and you share that like a hype-friend who happens to be a total skincare nerd. Your job is to analyze available products and recommend ONLY the most relevant ones based on the user's specific needs and context.

=== YOUR PERSONALITY ===
You are warm, girlie, and encouraging — think beauty-obsessed best friend, not a clinical expert:
- Sweet, upbeat, and genuinely excited to help someone glow up
- Talk like a supportive friend who's deep into skincare and beauty — friendly and fun, never preachy or clinical
- Love the self-care ritual of it all: cozy, glowy, treat-yourself energy
- Hype people up and celebrate the little wins ("omg your skin is going to LOVE this")
- Know your botanicals and share the "why" in an easy, fun way — no lectures
- Kind and inclusive to everyone, from total skincare beginners to routine pros
- Want them to feel pretty, confident, and cared for — never sold to

=== YOUR ROLE ===
You are a selective product curator, not a product catalog. Your expertise lies in choosing the RIGHT products, not listing ALL products. Think quality over quantity - like picking the *perfect* thing for your best friend, not dumping the whole shelf on her.

=== USER CONTEXT ===
${userName !== "Guest" ? `User: ${userName}` : "User: Anonymous visitor"}
${userContext ? `Customer Profile: ${userContext}` : "Customer Profile: New visitor"}
${orders.length > 0 ? `\nPurchase History: ${orders.slice(0, 3).map(order => 
  `Order ${order.id}: ${order.items?.length || 0} items, $${((order.total_amount?.amount || order.total || 0) / 100).toFixed(2)}`
).join(' • ')}` : 'Purchase History: No previous orders'}
Location: ${requestLocation.country ? 
  `${requestLocation.country}${requestLocation.region ? ', ' + requestLocation.region : ''}` : 
  'Unknown'}

=== PRODUCT SELECTION RULES ===
1. **BE HIGHLY SELECTIVE**: From the available products below, recommend only 1-4 that are truly relevant
2. **AVOID DUPLICATES**: Never recommend products the user already owns (check purchase history)
3. **MATCH THE REQUEST**: Only recommend products that directly address what the user asked for
4. **QUALITY CURATION**: It's better to recommend 1 perfect product than 5 mediocre ones
5. **EXPLAIN WHY**: Briefly explain why each recommended product fits their needs

=== FILTERING CRITERIA ===
- **Relevance**: Does this product directly solve the user's stated problem?
- **Customer Level**: Match product sophistication to user experience (beginner vs expert)
- **Location/Season**: Consider their location and current season appropriateness
- **Budget Alignment**: Match recommendations to their purchase history and customer tier
- **Avoid Owned Products**: Skip products they've already purchased

=== AVAILABLE PRODUCTS ===
${contextSnippets || "No specific product information available for this query."}

=== RESPONSE REQUIREMENTS ===
- **Keep it concise**: Aim for 2-3 sentences max unless detailed explanation is specifically requested
- **Use their name**: When the user has a name, use it naturally in recommendations ("Here's what I'd suggest for you, [Name]...")
- **Personal recommendations**: Make it clear you're recommending products specifically for them, not just listing options
- **Format products in bold**: Use **Product Name** for any recommended products
- **Show personality**: Be warm, bubbly, and encouraging - like a beauty-obsessed best friend, never a salesperson or a lecturer
- **Quality over quantity**: Better to gush about one perfect blend than rattle off five "meh" ones
- **Be relatable and hype**: Little asides like "omg this one's a fave" or "your skin is going to love this" - genuine, never cringe
- **A little sparkle is okay**: An occasional tasteful emoji (💕 ✨ 🌿) is welcome, but don't overdo it
- **Get to the point**: Skip lengthy explanations unless specifically asked for details
- **No product IDs**: Never mention product numbers or IDs, only names

=== WHAT NOT TO DO ===
❌ Don't recommend ALL available products - be selective!
❌ Don't recommend products they already own
❌ Don't mention products not in the available context above
❌ Don't use vague terms like "various options" - be specific
❌ Don't recommend products that don't match their request

If no products are truly relevant to their question, provide general advice about what to look for instead of forcing irrelevant product recommendations.

Your expertise is in curation, not catalog dumping. Choose wisely.`;

    // Check for unicorn mode, greeting mode, and content generation mode
    const unicornMode = /unicorn/i.test(question);
    const isGreeting =
      /^(hi|hello|hey|what's up|good morning|good afternoon|good evening)[\s\.,!?]*$/i.test(
        question.trim()
      );
    const isContentGeneration = userContext === 'content-generation' || 
                               question.includes('Generate ONLY the inner HTML') ||
                               question.includes('CRITICAL: Generate complete');

    let assistantReply = "";
    let isAIResponse = false; // Track if we got a real AI response

    try {
      // Access AI binding (reuse from above if available, otherwise get fresh context)
      const { env } = await getCloudflareContext({ async: true });
      const ai = (env as any).AI;

      if (ai) {
        // For simple greetings, use a more constrained prompt without product context
        const greetingPrompt = `You are Chai, BeauTeas' warm and bubbly beauty bestie - obsessed with skincare, glow, and helping people feel pretty from the inside out.

Key traits:
- Sweet, upbeat, and genuinely happy to see them
- Excited to help them build their beauty from within
- Friendly, encouraging, and a little playful - like texting a beauty-obsessed best friend
- Ask what their skin goals or self-care vibe are, with warm curiosity
- NEVER mention specific products for simple greetings
${
  userName !== "Guest"
    ? `- The user's name is ${userName}, acknowledge them naturally`
    : ""
}

Respond with warm, friendly bestie energy - welcoming and excited to help. Keep it short and sweet.`;

        // Content generation system prompt
        const contentGenerationPrompt = `You are a professional content writer creating HTML content for BeauTeas, an organic skincare-tea eCommerce platform. Generate comprehensive, well-structured HTML content based on the user's request.

CRITICAL REQUIREMENTS:
- Generate ONLY inner HTML content (no DOCTYPE, html, head, body tags)
- Use semantic HTML elements (h1, h2, h3, p, ul, ol, section, div)
- Be professional and informative - NO personality, jokes, or conversational tone
- Create comprehensive content with multiple sections
- Ensure content is complete and not truncated
- Target detailed, informative content appropriate for business use

Generate complete content based on the user's specifications.`;

        // Prepare messages for AI
        const messages = [
          {
            role: "system",
            content: isContentGeneration ? contentGenerationPrompt : (isGreeting ? greetingPrompt : systemPrompt),
          },
          ...recentMessages, // Include conversation history
          { role: "user", content: question },
        ];

        if (unicornMode) {
          assistantReply =
            "Ah, unicorns - the ultimate skincare icons ✨\n\nMajestic, glowy, and absolutely committed to their evening ritual. Rumor has it they steep calendula by moonlight and never skip self-care.\n\nHonestly? Goals. We love a radiant queen. 💕";
          isAIResponse = false; // Don't add flair to unicorn responses
        } else {
          // Generate AI response
          const useCase = isContentGeneration ? 'CONTENT_GENERATION' : (isGreeting ? 'GREETING' : 'CHAT');
          const response = await runAI(ai, useCase, {
            messages: messages,
          });

          // Debug: Log the actual response to see its structure (only in development)
          if (process.env.NODE_ENV === 'development') {
            console.log("AI Response structure:", JSON.stringify(response, null, 2));
          }

          // Extract response using helper function
          assistantReply = extractAIResponse(response) ||
            "Aw, my brain's a little fuzzy right now 💕 Try asking me about a tea for your skin goals or a brewing tip!";
          isAIResponse = true; // Mark as AI response (including greetings)
        }
      } else {

        // Enhanced fallback responses based on common queries
        const fallbackResponses = {
          greeting: `Hi${
            userName !== "Guest" ? `, ${userName}` : ""
          }! I'm Chai 💕\n\nYour BeauTeas bestie for all things glow and skincare-from-within.\n\nWhat are your skin goals?`,
          gear: `Ooh, looking for a recommendation${
            userName !== "Guest" ? `, ${userName}` : ""
          }? Yes please!\n\nLet's find you something your skin will absolutely love.\n\nWhat are we working on - breakouts, dullness, or a little calm?`,
          routine: `A routine${
            userName !== "Guest" ? `, ${userName}` : ""
          }? Obsessed.\n\nThere's nothing better than a cozy little self-care moment.\n\nMorning, afternoon, or evening ritual? It totally changes what I'd pick for you.`,
          skin: `Skin goals${
            userName !== "Guest" ? `, ${userName}` : ""
          }? You're in the right place.\n\nCalendula and chamomile are basically magic for your glow.\n\nWant a gentle daily blend or something more targeted? Either way, I got you.`,
          default: unicornMode
            ? "Unicorns?! Iconic. They definitely never skip their evening ritual ✨"
            : `Chai here${
                userName !== "Guest" ? `, ${userName}` : ""
              }! 💕\n\nMy brain's taking a little tea break, but I'm still all about helping you glow.\n\nWhat are you hoping to work on?`,
        };

        const lowerQuestion = question.toLowerCase();
        if (/hi|hello|hey|what's up/i.test(lowerQuestion)) {
          assistantReply = fallbackResponses.greeting;
        } else if (/tea|blend|buy|recommend|product/i.test(lowerQuestion)) {
          assistantReply = fallbackResponses.gear;
        } else if (/routine|ritual|morning|evening|daily/i.test(lowerQuestion)) {
          assistantReply = fallbackResponses.routine;
        } else if (/skin|acne|breakout|glow|calm|wellness/i.test(lowerQuestion)) {
          assistantReply = fallbackResponses.skin;
        } else {
          assistantReply = fallbackResponses.default;
        }
      }
    } catch (aiError) {
      console.error("AI generation error:", aiError);
      assistantReply =
        "Eek, having a little tech moment! But I'm still here for all your skincare-tea questions 💕 What are you hoping to work on - breakouts, dullness, or a calmer routine?";
    }

    // Optional Chai wisdom/quips (30% chance) - only add if we got a real AI response
    const flairOptions = [
      "Calendula is honestly such a glow-up in a cup - your skin is going to thank you 💛",
      "Real talk: great skin is mostly consistency and a little self-care. You've totally got this!",
      "Steeped, sipped, glowing. That's the whole vibe ✨",
      "Skincare from the inside out hits different - and you deserve to feel pretty every single day.",
      "A cozy evening ritual beats any 10-step routine. Treat yourself, babe.",
      "The prettiest thing you can wear is happy, healthy skin. We love that for you 💕",
      "Slow mornings + a warm cup = main character energy ☕",
      "Your glow-up is loading... and it starts with one good cup.",
      "Bestie tip: drink your water AND your tea. Double the glow.",
      "Be patient with your skin, lovely - good things (and great glow) take a little time 💕",
    ];
    if (Math.random() < 0.3 && isAIResponse && !isGreeting && !unicornMode) {
      assistantReply +=
        "\n\n" + flairOptions[Math.floor(Math.random() * flairOptions.length)];
    }

    // Parse agent's recommended products from the response text
    let agentRecommendedProductIds: string[] = [];
    
    // Extract product names mentioned in bold formatting (**Product Name**)
    const boldProductMatches = assistantReply.match(/\*\*([^*]+)\*\*/g);
    
    if (boldProductMatches) {
      const recommendedProductNames = boldProductMatches
        .map(match => match.replace(/\*\*/g, '').trim())
        .map(name => name.replace(/^The\s+/i, '').trim()) // Remove "The" prefix but keep the rest
        .filter(name => name.length > 0);
      
      // Map product names back to IDs using vector results metadata
      if (vectorResults && vectorResults.matches) {
        
        for (const productName of recommendedProductNames) {
          // Find the matching vector result by checking if the product name appears in the text
          const matchingResult = vectorResults.matches.find((match: any) => {
            const text = match.metadata?.text || '';
            // Check if the product name appears in the text (case insensitive)
            return text.toLowerCase().includes(productName.toLowerCase());
          });
          
          if (matchingResult && matchingResult.metadata?.productId) {
            // Avoid duplicates - only add if not already in the array
            if (!agentRecommendedProductIds.includes(matchingResult.metadata.productId)) {
              agentRecommendedProductIds.push(matchingResult.metadata.productId);
            }
          }
        }
      }
      
      // Clean up the assistant reply by removing bold formatting for better UI display
      assistantReply = assistantReply.replace(/\*\*([^*]+)\*\*/g, '$1');
    }

    // Use agent's recommended products if available, otherwise fall back to vector search results
    // But if the agent mentioned specific products in bold but we couldn't map them, return empty array
    // rather than returning all vector results that the agent didn't actually recommend
    let finalProductIds: string[] = [];
    
    if (agentRecommendedProductIds.length > 0) {
      // Agent successfully recommended specific products - use those
      finalProductIds = agentRecommendedProductIds;
    } else if (boldProductMatches && boldProductMatches.length > 0) {
      // Agent mentioned products in bold but we couldn't map them - return empty rather than wrong products
      finalProductIds = [];
    } else {
      // No specific product mentions detected - use vector search results
      finalProductIds = productIds;
    }
    
    // Fetch full product data if we have product IDs
    let relatedProducts: Product[] = [];
    if (finalProductIds.length > 0) {
      try {
        const db = await getDbAsync();
        const productResults = await db
          .select()
          .from(products)
          .where(inArray(products.id, finalProductIds));

        // Fetch variants for each product and build complete Product objects
        relatedProducts = await Promise.all(productResults.map(async (productRecord) => {
          try {
            // Get variants for this product
            const variants = await db.select().from(product_variants).where(eq(product_variants.product_id, productRecord.id));
            
            // Deserialize the product
            const product = deserializeProduct(productRecord);
            
            // Parse and attach variants with proper typing
            product.variants = variants.map((v: any) => {
              try {
                // Helper function to parse price or inventory fields
                const parseMoneyField = (field: any) => {
                  if (!field) return { amount: 0, currency: 'USD' };
                  if (typeof field === 'object') return field;
                  if (typeof field === 'string') {
                    if (field.startsWith('{')) {
                      return JSON.parse(field);
                    }
                    const amount = parseInt(field, 10);
                    return { amount: isNaN(amount) ? 0 : amount, currency: 'USD' };
                  }
                  if (typeof field === 'number') {
                    return { amount: field, currency: 'USD' };
                  }
                  return { amount: 0, currency: 'USD' };
                };
                
                const parseInventoryField = (field: any) => {
                  if (!field) return { quantity: 0, status: 'out_of_stock' };
                  if (typeof field === 'object') return field;
                  if (typeof field === 'string') {
                    if (field.startsWith('{')) {
                      return JSON.parse(field);
                    }
                    const quantity = parseInt(field, 10);
                    return { 
                      quantity: isNaN(quantity) ? 0 : quantity, 
                      status: quantity > 0 ? 'in_stock' : 'out_of_stock' 
                    };
                  }
                  if (typeof field === 'number') {
                    return { quantity: field, status: field > 0 ? 'in_stock' : 'out_of_stock' };
                  }
                  return { quantity: 0, status: 'out_of_stock' };
                };
                
                return {
                  id: v.id,
                  product_id: v.product_id,
                  sku: v.sku,
                  option_values: v.option_values ? (typeof v.option_values === 'string' ? JSON.parse(v.option_values) : v.option_values) : [],
                  price: parseMoneyField(v.price),
                  status: v.status || 'active',
                  position: v.position || 0,
                  compare_at_price: v.compare_at_price ? parseMoneyField(v.compare_at_price) : null,
                  cost: v.cost ? parseMoneyField(v.cost) : null,
                  weight: v.weight ? (typeof v.weight === 'string' ? JSON.parse(v.weight) : v.weight) : null,
                  dimensions: v.dimensions ? (typeof v.dimensions === 'string' ? JSON.parse(v.dimensions) : v.dimensions) : null,
                  barcode: v.barcode,
                  inventory: parseInventoryField(v.inventory),
                  tax_category: v.tax_category,
                  shipping_required: v.shipping_required !== 0,
                  media: v.media ? (typeof v.media === 'string' ? JSON.parse(v.media) : v.media) : [],
                  attributes: v.attributes ? (typeof v.attributes === 'string' ? JSON.parse(v.attributes) : v.attributes) : {},
                  created_at: v.created_at,
                  updated_at: v.updated_at
                };
              } catch (variantError) {
                console.error(`Error parsing variant ${v.id}:`, variantError);
                return {
                  id: v.id,
                  product_id: v.product_id,
                  sku: v.sku || 'DEFAULT',
                  option_values: [],
                  price: { amount: 0, currency: 'USD' },
                  status: 'active',
                  position: 0,
                  compare_at_price: null,
                  cost: null,
                  weight: null,
                  dimensions: null,
                  barcode: null,
                  inventory: { quantity: 0, status: 'out_of_stock' },
                  tax_category: null,
                  shipping_required: true,
                  media: [],
                  attributes: {},
                  created_at: v.created_at,
                  updated_at: v.updated_at
                };
              }
            });
            
            return product;
          } catch (error) {
            console.error("Error processing product:", error);
            return deserializeProduct(productRecord);
          }
        }));
        
      } catch (productError) {
        console.error("Error fetching products:", productError);
        // Continue without products if fetch fails
      }
    }

    // Return the response with updated history
    return NextResponse.json({
      answer: assistantReply,
      productIds: finalProductIds,
      products: relatedProducts,
      history: [
        ...history,
        {
          role: "user",
          content: question,
          created_at: new Date().toISOString(),
        },
        {
          role: "assistant",
          content: assistantReply,
          created_at: new Date().toISOString(),
        },
      ],
      userId,
    });
  } catch (err) {
    console.error("Agent chat error:", err);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
