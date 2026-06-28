import { searchProducts, getProductBySlug, getProductsByCategory, getActiveProducts } from '../../models/mach/products';
import { listCategories, getCategoryDisplayName } from '../../models/mach/category';
import { RecommendRequest, MCPToolResponse } from '../types';
import { enhanceUserContext } from '../context';
import { distinctCategoryCount, ritualBundleSuggestions } from '../catalog';
import { Product } from '../../types';

export async function getRecommendations(
  request: RecommendRequest,
  sessionId: string
): Promise<MCPToolResponse<Product[]>> {
  const startTime = Date.now();
  
  try {
    const { context } = request;
    const userContext = enhanceUserContext(request.agent_context || null);
    
    let recommendations: Product[] = [];
    
    // Get current product context if provided
    let currentProduct: Product | null = null;
    if (context.currentProduct) {
      currentProduct = await getProductBySlug(context.currentProduct.toString());
    }
    
    // Generate recommendations based on context
    if (context.useCase) {
      recommendations = await getUseCaseRecommendations(context.useCase, userContext);
    } else if (context.userActivity) {
      recommendations = await getActivityRecommendations(context.userActivity, userContext);
    } else if (currentProduct) {
      recommendations = await getRelatedProductRecommendations(currentProduct, userContext);
    } else {
      // General recommendations based on user context
      recommendations = await getGeneralRecommendations(userContext);
    }
    
    // Filter by budget if provided
    if (context.budget || userContext.budget) {
      const budget = context.budget || userContext.budget;
      recommendations = recommendations.filter(product => {
        const price = product.variants?.[0]?.price || 0;
        return price <= budget!;
      });
    }
    
    // Sort by relevance and quality
    recommendations = sortRecommendations(recommendations, userContext);
    
    // Limit to top 10
    recommendations = recommendations.slice(0, 10);
    
    // Generate cross-site recommendations
    const alternativeSites = generateCrossSiteRecommendations();
    const bundlingOpportunities = generateBundlingRecommendations(recommendations);
    const costOptimizations = generateCostRecommendations(recommendations, context.budget || userContext.budget);
    
    const fulfillmentPercentage = recommendations.length > 0 ? 100 : 50;
    const satisfaction = calculateRecommendationSatisfaction(recommendations, userContext, context);
    
    const processingTime = Date.now() - startTime;
    
    return {
      success: true,
      data: recommendations,
      context: {
        session_id: sessionId,
        agent_id: request.agent_context?.agentId || 'unknown',
        processing_time_ms: processingTime
      },
      recommendations: {
        alternative_sites: alternativeSites,
        bundling_opportunities: bundlingOpportunities,
        cost_optimization: costOptimizations
      },
      metadata: {
        can_fulfill_percentage: fulfillmentPercentage,
        estimated_satisfaction: satisfaction,
        next_actions: generateRecommendationActions(recommendations, context)
      }
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    return {
      success: false,
      data: [],
      context: {
        session_id: sessionId,
        agent_id: request.agent_context?.agentId || 'unknown',
        processing_time_ms: processingTime
      },
      metadata: {
        can_fulfill_percentage: 0,
        estimated_satisfaction: 0,
        next_actions: ['Check recommendation parameters', 'Try different context']
      }
    };
  }
}

async function getUseCaseRecommendations(useCase: string, userContext: any): Promise<Product[]> {
  const useCaseLower = useCase.toLowerCase();

  // Prefer a matching catalog category (e.g. "green tea", "skincare", "herbal").
  const categories = await listCategories();
  const matched = categories.find((cat) => {
    const name = getCategoryDisplayName(cat).toLowerCase();
    return name.length > 0 && (useCaseLower.includes(name) || name.includes(useCaseLower));
  });
  if (matched) {
    const byCategory = await getProductsByCategory(matched.id);
    if (byCategory.length > 0) return byCategory;
  }

  // Fall back to a name search, then to the general catalog.
  const byName = await searchProducts(useCase);
  if (byName.length > 0) return byName;

  return getGeneralRecommendations(userContext);
}

async function getActivityRecommendations(activity: string, userContext: any): Promise<Product[]> {
  // Activities are free-form hints from the agent context; resolve them against
  // the live catalog the same way as a use case rather than a hardcoded map.
  return getUseCaseRecommendations(activity, userContext);
}

async function getRelatedProductRecommendations(product: Product, userContext: any): Promise<Product[]> {
  // Recommend other products from the same catalog categories as this product.
  const categoryIds = Array.isArray(product.categories) ? product.categories : [];
  for (const categoryId of categoryIds) {
    const related = await getProductsByCategory(categoryId);
    const filtered = related.filter((p) => String(p.id) !== String(product.id));
    if (filtered.length > 0) return filtered;
  }

  return getGeneralRecommendations(userContext);
}

async function getGeneralRecommendations(userContext: any): Promise<Product[]> {
  // Base recommendations on a stated interest if it matches the catalog,
  // otherwise fall back to the full active catalog.
  if (userContext.activities?.length > 0) {
    const matches = await searchProducts(userContext.activities[0]);
    if (matches.length > 0) return matches;
  }

  return getActiveProducts();
}

function sortRecommendations(products: Product[], userContext: any): Product[] {
  return products.sort((a, b) => {
    let aScore = 0;
    let bScore = 0;
    
    // Prefer products matching user activities
    if (userContext.activities) {
      for (const activity of userContext.activities) {
        if ((typeof a.name === 'string' ? a.name : String(a.name || '')).toLowerCase().includes(activity.toLowerCase()) || 
            (typeof a.description === 'string' ? a.description : String(a.description || '')).toLowerCase().includes(activity.toLowerCase())) {
          aScore += 10;
        }
        if ((typeof b.name === 'string' ? b.name : String(b.name || '')).toLowerCase().includes(activity.toLowerCase()) || 
            (typeof b.description === 'string' ? b.description : String(b.description || '')).toLowerCase().includes(activity.toLowerCase())) {
          bScore += 10;
        }
      }
    }
    
    // Prefer products from preferred brands
    if (userContext.preferredBrands) {
      for (const brand of userContext.preferredBrands) {
        if ((typeof a.name === 'string' ? a.name : String(a.name || '')).toLowerCase().includes(brand.toLowerCase())) aScore += 5;
        if ((typeof b.name === 'string' ? b.name : String(b.name || '')).toLowerCase().includes(brand.toLowerCase())) bScore += 5;
      }
    }
    
    // Consider price within budget
    const aPrice = a.variants?.[0]?.price || 0;
    const bPrice = b.variants?.[0]?.price || 0;
    
    if (userContext.budget) {
      if (aPrice <= userContext.budget) aScore += 2;
      if (bPrice <= userContext.budget) bScore += 2;
    }
    
    return bScore - aScore;
  });
}

function generateCrossSiteRecommendations(): string[] {
  // BeauTeas is a first-party store focused on its own organic tea catalog;
  // we don't refer agents to outside retailers.
  return [];
}

function generateBundlingRecommendations(products: Product[]): string[] {
  // Suggest building/completing the daily ritual based on how many distinct
  // catalog categories the recommended products span.
  return ritualBundleSuggestions(distinctCategoryCount(products));
}

function generateCostRecommendations(products: Product[], budget?: number): string[] {
  if (!budget) return [];
  
  const recommendations: string[] = [];
  const totalCost = products.reduce((sum, p) => sum + (typeof p.variants?.[0]?.price === 'number' ? p.variants[0].price : (p.variants?.[0]?.price as any)?.amount || 0), 0);
  
  if (totalCost > budget * 1.2) {
    recommendations.push('Choose sample-size blends to stay within budget');
    recommendations.push('Look for current tea bundle offers');
  } else if (totalCost < budget * 0.8) {
    recommendations.push('Budget allows for premium blends or a gift set');
    recommendations.push('Consider adding complementary blends within budget');
  }
  
  return recommendations;
}

function calculateRecommendationSatisfaction(products: Product[], userContext: any, context: any): number {
  let satisfaction = 60; // Base satisfaction
  
  if (products.length > 0) satisfaction += 20;
  if (products.length >= 5) satisfaction += 10;
  
  // Boost for matching user preferences
  if (userContext.activities?.length > 0) {
    const matchingProducts = products.filter(p => 
      userContext.activities.some((activity: string) => 
        (typeof p.name === 'string' ? p.name : String(p.name || '')).toLowerCase().includes(activity.toLowerCase()) ||
        (typeof p.description === 'string' ? p.description : String(p.description || '')).toLowerCase().includes(activity.toLowerCase())
      )
    );
    satisfaction += (matchingProducts.length / products.length) * 20;
  }
  
  return Math.min(100, satisfaction);
}

function generateRecommendationActions(products: Product[], context: any): string[] {
  const actions: string[] = [];
  
  if (products.length > 0) {
    actions.push('Review recommended products');
    actions.push('Add preferred items to cart');
    actions.push('Get detailed product comparisons');
  }
  
  if (context.budget) {
    actions.push('Verify items fit within budget');
  }
  
  if (products.length === 0) {
    actions.push('Refine search criteria');
    actions.push('Browse related categories');
  }
  
  return actions;
}