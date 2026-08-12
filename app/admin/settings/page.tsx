/**
 * === Admin Settings Page ===
 *
 * Comprehensive settings management interface for configuring store operations,
 * AI assistant behavior, and system-wide preferences. Features tabbed interface
 * with real-time updates and vector index management capabilities.
 *
 * === Features ===
 * - **Store Configuration**: Basic store information, currency, and policies
 * - **AI Assistant Settings**: Chai personality, response style, and features
 * - **System Configuration**: Debug mode, maintenance, and performance settings
 * - **Vector Index Management**: Reindex products and knowledge base
 * - **Real-time Updates**: Live status indicators and save confirmations
 * - **Tabbed Interface**: Organized settings categories for easy navigation
 *
 * === Settings Categories ===
 * - **Store Settings**: Store name, contact info, currency, tax rates
 * - **AI Settings**: Chai personality mode, response length, personalization
 * - **System Settings**: Debug mode, maintenance mode, analytics, notifications
 *
 * === AI Configuration Options ===
 * - **Personality Mode**: Professional, friendly, or cheeky response style
 * - **Response Length**: Concise, detailed, or adaptive based on context
 * - **Product Recommendations**: Toggle AI product suggestion features
 * - **Personalization**: Enable/disable user-specific recommendations
 * - **Vector Index**: Monitor and refresh knowledge base indexing
 *
 * === System Management Features ===
 * - **Debug Mode**: Enable detailed logging and error reporting
 * - **Maintenance Mode**: Temporary site lockdown for updates
 * - **Analytics**: Control data collection and performance monitoring
 * - **Email Notifications**: Configure transactional email settings
 * - **Caching**: Performance optimization controls
 * - **API Rate Limiting**: Request throttling configuration
 *
 * === Technical Implementation ===
 * - **Client Component**: Interactive settings with immediate feedback
 * - **State Management**: Local state for settings data and UI states
 * - **API Integration**: Save settings via admin API endpoints
 * - **Vector Management**: Integration with `/api/admin/vectorize` endpoint
 * - **Form Validation**: Input validation and error handling
 * - **Performance**: Optimized re-rendering and state updates
 *
 * === Vector Index Management ===
 * - **Status Monitoring**: Real-time vector index health
 * - **Reindex Controls**: Manual trigger for content reindexing
 * - **Progress Tracking**: Visual feedback during reindexing operations
 * - **Error Handling**: Graceful handling of reindex failures
 *
 * @returns JSX element with complete admin settings interface
 */

"use client";

import { useState, useEffect } from "react";
import { brand } from "@/lib/brand.config";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Settings, Store, Bot, Mail, Database,
  RefreshCw, Save, Globe, DollarSign,
  Shield, Zap, AlertCircle, CheckCircle,
  Share2, Plus, Trash2
} from "lucide-react";
import type { ShippingTier } from "@/lib/sale/rules";
import { addTierRow, removeTierRow, setOpenEndedTier, hasZeroCostTier, hasNoOpenEndedTier } from "@/lib/sale/tier-editor";

interface SystemSettings {
  maintenance_mode: boolean;
  maintenance_message: string;
  debug_mode: boolean;
}

interface StoreSettings {
  free_shipping_threshold: number;
  tax_rate: number;
  auto_fulfill_orders: boolean;
}

interface ShippingSettings {
  methods: Array<{
    id: string;
    label: string;
    cost: number;
    estimatedDays: number;
    enabled: boolean;
  }>;
  free_methods: string[];
  // GOOB: quantity-tiered shipping (lib/sale/rules). EMPTY means "not
  // configured" — the flat per-method costs above stay in force. Any
  // non-empty array replaces them entirely (see migrations/0025).
  tiers: ShippingTier[];
}

interface RefundSettings {
  shipping_refunded_partial: boolean;
  shipping_refunded_full: boolean;
  restocking_fee_percent: number;
  return_window_days: number;
  minimum_refund_amount: number;
  restock_on_external_refund: boolean;
}

interface PromotionSettings {
  site_wide_discount_percent: number;
  banner_enabled: boolean;
  banner_text: string;
  banner_type: 'info' | 'warning' | 'success' | 'error';
  new_customer_discount: number;
}

interface SocialMediaSettings {
  instagram: string;
  youtube: string;
  linkedin: string;
  twitter: string;
  facebook: string;
  tiktok: string;
}

interface RecommendationSettings {
  strategy: 'deterministic' | 'ai_batch';
  personalize: boolean;
  exclude_owned: boolean;
  limit: number;
}

interface RecommendationsRebuildSummary {
  productsProcessed: number;
  rowsWritten: number;
  durationMs: number;
}

interface VectorIndexStatus {
  knowledgeBaseSize: number;
  vectorIndexStatus: string;
  lastIndexed: string;
}

export default function AdminSettingsPage() {
  const [activeTab, setActiveTab] = useState<"system" | "store" | "shipping" | "refunds" | "promotions" | "recommendations" | "social" | "admins">("system");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  
  const [systemSettings, setSystemSettings] = useState<SystemSettings>({
    maintenance_mode: false,
    maintenance_message: "We're making some improvements! We'll be back soon.",
    debug_mode: false
  });

  const [storeSettings, setStoreSettings] = useState<StoreSettings>({
    free_shipping_threshold: 75,
    tax_rate: 8.25,
    auto_fulfill_orders: true
  });

  const [shippingSettings, setShippingSettings] = useState<ShippingSettings>({
    methods: [
      { id: 'standard', label: 'Standard (5–7 days)', cost: 5.99, estimatedDays: 5, enabled: true },
      { id: 'express', label: 'Express (2–3 days)', cost: 9.99, estimatedDays: 2, enabled: true },
      { id: 'overnight', label: 'Overnight', cost: 19.99, estimatedDays: 1, enabled: true }
    ],
    free_methods: ['standard'],
    // Matches the migration 0025 seed (empty = not configured). Unlike the
    // defaults above, a non-empty placeholder here would be a live pricing
    // change if `loadSettings` ever failed to land before a save — see
    // lib/sale/tier-editor.ts.
    tiers: []
  });

  const [refundSettings, setRefundSettings] = useState<RefundSettings>({
    shipping_refunded_partial: false,
    shipping_refunded_full: false,
    restocking_fee_percent: 0,
    return_window_days: 30,
    minimum_refund_amount: 500,
    // BMC-213: default ON — parity with an app refund, which always restocks.
    restock_on_external_refund: true
  });

  const [promotionSettings, setPromotionSettings] = useState<PromotionSettings>({
    site_wide_discount_percent: 0,
    banner_enabled: false,
    banner_text: 'We’re closing BeauTeas. Everything must go while supplies last.',
    banner_type: 'info',
    new_customer_discount: 0
  });

  const [socialMediaSettings, setSocialMediaSettings] = useState<SocialMediaSettings>({
    instagram: '',
    youtube: '',
    linkedin: '',
    twitter: '',
    facebook: '',
    tiktok: ''
  });

  const [recommendationSettings, setRecommendationSettings] = useState<RecommendationSettings>({
    strategy: 'deterministic',
    personalize: true,
    exclude_owned: true,
    limit: 3
  });

  // Recommendations rebuild state
  const [recRebuildLoading, setRecRebuildLoading] = useState(false);
  const [recRebuildSummary, setRecRebuildSummary] = useState<RecommendationsRebuildSummary | null>(null);

  const [vectorStatus, setVectorStatus] = useState<VectorIndexStatus>({
    knowledgeBaseSize: 38,
    vectorIndexStatus: "healthy",
    lastIndexed: new Date().toLocaleDateString()
  });
  
  // Admin users state
  const [adminUsers, setAdminUsers] = useState<string[]>([]);
  const [newUserId, setNewUserId] = useState<string>('');
  const [adminUsersLoading, setAdminUsersLoading] = useState(false);

  // Load settings from API on component mount
  useEffect(() => {
    loadSettings();
    loadAdminUsers();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/settings');
      if (response.ok) {
        const { settings } = await response.json() as any;
        
        // Parse settings by category
        settings.forEach((setting: any) => {
          const value = JSON.parse(setting.value);
          
          if (setting.category === 'system') {
            if (setting.key === 'system.maintenance_mode') setSystemSettings(prev => ({ ...prev, maintenance_mode: value }));
            if (setting.key === 'system.maintenance_message') setSystemSettings(prev => ({ ...prev, maintenance_message: value }));
            if (setting.key === 'system.debug_mode') setSystemSettings(prev => ({ ...prev, debug_mode: value }));
          } else if (setting.category === 'store') {
            if (setting.key === 'store.free_shipping_threshold') setStoreSettings(prev => ({ ...prev, free_shipping_threshold: value }));
            if (setting.key === 'store.tax_rate') setStoreSettings(prev => ({ ...prev, tax_rate: value }));
            if (setting.key === 'store.auto_fulfill_orders') setStoreSettings(prev => ({ ...prev, auto_fulfill_orders: value }));
          } else if (setting.category === 'shipping') {
            if (setting.key === 'shipping.methods') setShippingSettings(prev => ({ ...prev, methods: value }));
            if (setting.key === 'shipping.free_methods') setShippingSettings(prev => ({ ...prev, free_methods: value }));
            if (setting.key === 'shipping.tiers') setShippingSettings(prev => ({ ...prev, tiers: value }));
          } else if (setting.category === 'refund') {
            if (setting.key === 'refund.shipping_refunded_partial') setRefundSettings(prev => ({ ...prev, shipping_refunded_partial: value }));
            if (setting.key === 'refund.shipping_refunded_full') setRefundSettings(prev => ({ ...prev, shipping_refunded_full: value }));
            if (setting.key === 'refund.restocking_fee_percent') setRefundSettings(prev => ({ ...prev, restocking_fee_percent: value }));
            if (setting.key === 'refund.return_window_days') setRefundSettings(prev => ({ ...prev, return_window_days: value }));
            if (setting.key === 'refund.minimum_refund_amount') setRefundSettings(prev => ({ ...prev, minimum_refund_amount: value }));
            if (setting.key === 'refund.restock_on_external_refund') setRefundSettings(prev => ({ ...prev, restock_on_external_refund: value !== false }));
          } else if (setting.category === 'promotions') {
            if (setting.key === 'promotions.site_wide_discount_percent') setPromotionSettings(prev => ({ ...prev, site_wide_discount_percent: value }));
            if (setting.key === 'promotions.banner_enabled') setPromotionSettings(prev => ({ ...prev, banner_enabled: value }));
            if (setting.key === 'promotions.banner_text') setPromotionSettings(prev => ({ ...prev, banner_text: value }));
            if (setting.key === 'promotions.banner_type') setPromotionSettings(prev => ({ ...prev, banner_type: value }));
            if (setting.key === 'promotions.new_customer_discount') setPromotionSettings(prev => ({ ...prev, new_customer_discount: value }));
          } else if (setting.category === 'social') {
            if (setting.key === 'social.instagram') setSocialMediaSettings(prev => ({ ...prev, instagram: value }));
            if (setting.key === 'social.youtube') setSocialMediaSettings(prev => ({ ...prev, youtube: value }));
            if (setting.key === 'social.linkedin') setSocialMediaSettings(prev => ({ ...prev, linkedin: value }));
            if (setting.key === 'social.twitter') setSocialMediaSettings(prev => ({ ...prev, twitter: value }));
            if (setting.key === 'social.facebook') setSocialMediaSettings(prev => ({ ...prev, facebook: value }));
            if (setting.key === 'social.tiktok') setSocialMediaSettings(prev => ({ ...prev, tiktok: value }));
          } else if (setting.category === 'recommendations') {
            if (setting.key === 'recommendations.strategy') setRecommendationSettings(prev => ({ ...prev, strategy: value }));
            if (setting.key === 'recommendations.personalize') setRecommendationSettings(prev => ({ ...prev, personalize: value }));
            if (setting.key === 'recommendations.exclude_owned') setRecommendationSettings(prev => ({ ...prev, exclude_owned: value }));
            if (setting.key === 'recommendations.limit') setRecommendationSettings(prev => ({ ...prev, limit: value }));
          }
        });
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  };

  // Load admin users from API
  const loadAdminUsers = async () => {
    try {
      setAdminUsersLoading(true);
      const response = await fetch('/api/admin/users?admin=true');
      if (response.ok) {
        const { adminUsers } = await response.json() as { adminUsers: string[] };
        setAdminUsers(adminUsers);
      }
    } catch (error) {
      console.error('Error loading admin users:', error);
    } finally {
      setAdminUsersLoading(false);
    }
  };

  // Add new admin user
  const addAdminUser = async () => {
    if (!newUserId.trim()) return;
    if (!newUserId.match(/^user_[a-zA-Z0-9]+$/)) {
      alert('User ID must start with "user_" and contain only letters and numbers');
      return;
    }

    try {
      setAdminUsersLoading(true);
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          userId: newUserId.trim()
        })
      });

      const result = await response.json() as { message?: string; error?: string };
      
      if (response.ok) {
        setNewUserId('');
        loadAdminUsers(); // Reload the list
        alert('Admin user added successfully!');
      } else {
        alert(`Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Error adding admin user:', error);
      alert('Failed to add admin user');
    } finally {
      setAdminUsersLoading(false);
    }
  };

  // Remove admin user
  const removeAdminUser = async (userId: string) => {
    if (adminUsers.length <= 1) {
      alert('Cannot remove the last admin user');
      return;
    }

    if (!confirm(`Are you sure you want to remove admin access for ${userId}?`)) {
      return;
    }

    try {
      setAdminUsersLoading(true);
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove',
          userId
        })
      });

      const result = await response.json() as { message?: string; error?: string };
      
      if (response.ok) {
        loadAdminUsers(); // Reload the list
        alert('Admin user removed successfully!');
      } else {
        alert(`Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Error removing admin user:', error);
      alert('Failed to remove admin user');
    } finally {
      setAdminUsersLoading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setSaved(false);
    
    try {
      // Build updates array from all settings
      const updates = [
        // System settings
        { key: 'system.maintenance_mode', value: systemSettings.maintenance_mode, category: 'system' },
        { key: 'system.maintenance_message', value: systemSettings.maintenance_message, category: 'system' },
        { key: 'system.debug_mode', value: systemSettings.debug_mode, category: 'system' },
        
        // Store settings
        { key: 'store.free_shipping_threshold', value: storeSettings.free_shipping_threshold, category: 'store' },
        { key: 'store.tax_rate', value: storeSettings.tax_rate, category: 'store' },
        { key: 'store.auto_fulfill_orders', value: storeSettings.auto_fulfill_orders, category: 'store' },
        
        // Shipping settings
        { key: 'shipping.methods', value: shippingSettings.methods, category: 'shipping' },
        { key: 'shipping.free_methods', value: shippingSettings.free_methods, category: 'shipping' },
        { key: 'shipping.tiers', value: shippingSettings.tiers, category: 'shipping' },
        
        // Refund settings
        { key: 'refund.shipping_refunded_partial', value: refundSettings.shipping_refunded_partial, category: 'refund' },
        { key: 'refund.shipping_refunded_full', value: refundSettings.shipping_refunded_full, category: 'refund' },
        { key: 'refund.restocking_fee_percent', value: refundSettings.restocking_fee_percent, category: 'refund' },
        { key: 'refund.return_window_days', value: refundSettings.return_window_days, category: 'refund' },
        { key: 'refund.minimum_refund_amount', value: refundSettings.minimum_refund_amount, category: 'refund' },
        { key: 'refund.restock_on_external_refund', value: refundSettings.restock_on_external_refund, category: 'refund' },
        
        // Promotion settings
        { key: 'promotions.site_wide_discount_percent', value: promotionSettings.site_wide_discount_percent, category: 'promotions' },
        { key: 'promotions.banner_enabled', value: promotionSettings.banner_enabled, category: 'promotions' },
        { key: 'promotions.banner_text', value: promotionSettings.banner_text, category: 'promotions' },
        { key: 'promotions.banner_type', value: promotionSettings.banner_type, category: 'promotions' },
        { key: 'promotions.new_customer_discount', value: promotionSettings.new_customer_discount, category: 'promotions' },
        
        // Social media settings
        { key: 'social.instagram', value: socialMediaSettings.instagram, category: 'social' },
        { key: 'social.youtube', value: socialMediaSettings.youtube, category: 'social' },
        { key: 'social.linkedin', value: socialMediaSettings.linkedin, category: 'social' },
        { key: 'social.twitter', value: socialMediaSettings.twitter, category: 'social' },
        { key: 'social.facebook', value: socialMediaSettings.facebook, category: 'social' },
        { key: 'social.tiktok', value: socialMediaSettings.tiktok, category: 'social' },

        // Recommendations settings
        { key: 'recommendations.strategy', value: recommendationSettings.strategy, category: 'recommendations', data_type: 'string' },
        { key: 'recommendations.personalize', value: recommendationSettings.personalize, category: 'recommendations', data_type: 'boolean' },
        { key: 'recommendations.exclude_owned', value: recommendationSettings.exclude_owned, category: 'recommendations', data_type: 'boolean' },
        { key: 'recommendations.limit', value: recommendationSettings.limit, category: 'recommendations', data_type: 'number' },
      ];
      
      const response = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ updates }),
      });
      
      if (response.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        const error = await response.json() as any;
        alert('Failed to save settings: ' + (error?.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Error saving settings: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const triggerVectorReindex = async () => {
    try {
      setLoading(true);
      // Call admin vectorize endpoint (now uses session auth)
      const response = await fetch("/api/admin/vectorize");
      if (response.ok) {
        const result = await response.json() as any;
        setVectorStatus(prev => ({
          ...prev,
          lastIndexed: new Date().toLocaleDateString(),
          knowledgeBaseSize: result?.summary?.totalIndexed || prev.knowledgeBaseSize
        }));
        alert(`Vector reindex complete! Indexed ${result?.summary?.totalIndexed || 0} items in ${(result?.executionTimeMs / 1000).toFixed(1)}s.`);
      } else {
        const error = await response.json() as any;
        alert("Failed to trigger reindex: " + (error?.error || "Unknown error"));
      }
    } catch (error) {
      console.error("Reindex error:", error);
      alert("Error triggering reindex: " + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const triggerRecommendationsRebuild = async () => {
    try {
      setRecRebuildLoading(true);
      const response = await fetch('/api/admin/recommendations/rebuild', {
        method: 'POST'
      });

      if (response.ok) {
        const result = await response.json() as RecommendationsRebuildSummary & { success: boolean };
        setRecRebuildSummary({
          productsProcessed: result.productsProcessed,
          rowsWritten: result.rowsWritten,
          durationMs: result.durationMs
        });
        alert(`Recommendations rebuild complete! Processed ${result.productsProcessed} products, wrote ${result.rowsWritten} rows in ${(result.durationMs / 1000).toFixed(1)}s.`);
      } else {
        const error = await response.json() as any;
        alert('Failed to rebuild recommendations: ' + (error?.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Recommendations rebuild error:', error);
      alert('Error rebuilding recommendations: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setRecRebuildLoading(false);
    }
  };

  const tabs = [
    { id: "system" as const, label: "System", icon: Settings, description: "Maintenance & debug" },
    { id: "store" as const, label: "Store", icon: Store, description: "Operations & policies" },
    { id: "shipping" as const, label: "Shipping", icon: Zap, description: "Methods & pricing" },
    { id: "refunds" as const, label: "Refunds", icon: RefreshCw, description: "Return policies" },
    { id: "promotions" as const, label: "Promotions", icon: DollarSign, description: "Sales & banners" },
    { id: "recommendations" as const, label: "Recommendations", icon: Bot, description: "PDP strategy & rebuild" },
    { id: "social" as const, label: "Social Media", icon: Share2, description: "Social links" },
    { id: "admins" as const, label: "Admin Users", icon: Shield, description: "Access management" }
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary mb-2">Admin Settings</h1>
          <p className="text-text-secondary">Configure your store and system preferences</p>
        </div>
        <div className="flex items-center space-x-3">
          {saved && (
            <Badge className="bg-state-success-bg text-state-success">
              <CheckCircle className="w-3 h-3 mr-1" />
              Saved
            </Badge>
          )}
          <Button
            onClick={handleSave}
            disabled={loading}
          >
            {loading ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save Changes
          </Button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex space-x-1 bg-white border border-border-default p-1 rounded-lg">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex items-center space-x-2 px-4 py-3 rounded-md transition-all flex-1
                ${activeTab === tab.id
                  ? 'bg-primary-500 text-text-inverse'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface'
                }
              `}
            >
              <Icon className="w-4 h-4" />
              <div className="text-left">
                <div className="font-medium">{tab.label}</div>
                <div className="text-xs opacity-75">{tab.description}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* System Settings */}
      {activeTab === "system" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="admin-card p-6">
            <div className="flex items-center space-x-3 mb-4">
              <AlertCircle className="w-5 h-5 text-primary-600" />
              <h3 className="text-lg font-semibold text-text-primary">Maintenance Mode</h3>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-text-secondary">Maintenance Mode</label>
                  <p className="text-xs text-text-muted">Block public access (admin still works)</p>
                </div>
                <Switch
                  checked={systemSettings.maintenance_mode}
                  onCheckedChange={(checked) => setSystemSettings(prev => ({ ...prev, maintenance_mode: checked }))}
                />
              </div>
              
              {systemSettings.maintenance_mode && (
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">Maintenance Message</label>
                  <Textarea
                    value={systemSettings.maintenance_message}
                    onChange={(e) => setSystemSettings(prev => ({ ...prev, maintenance_message: e.target.value }))}
                    className="admin-input"
                    rows={3}
                    placeholder="Message shown to visitors during maintenance"
                  />
                </div>
              )}
              
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-text-secondary">Debug Mode</label>
                  <p className="text-xs text-text-muted">Enable detailed error logging</p>
                </div>
                <Switch
                  checked={systemSettings.debug_mode}
                  onCheckedChange={(checked) => setSystemSettings(prev => ({ ...prev, debug_mode: checked }))}
                />
              </div>
            </div>
          </Card>

          <Card className="admin-card p-6">
            <div className="flex items-center space-x-3 mb-4">
              <Database className="w-5 h-5 text-state-info" />
              <h3 className="text-lg font-semibold text-text-primary">Vector Index Status</h3>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Status</span>
                <Badge className="bg-state-success-bg text-state-success">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  {vectorStatus.vectorIndexStatus}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Indexed Items</span>
                <span className="text-text-primary font-medium">{vectorStatus.knowledgeBaseSize} items</span>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Last Indexed</span>
                <span className="text-text-primary font-medium">{vectorStatus.lastIndexed}</span>
              </div>
              
              <div className="pt-4 border-t border-border-default">
                <Button
                  onClick={triggerVectorReindex}
                  disabled={loading}
                  variant="outline"
                  className="w-full border-secondary-400 text-secondary-600 hover:bg-secondary-500 hover:text-text-inverse"
                >
                  {loading ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  Rebuild Vector Index
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Store Settings */}
      {activeTab === "store" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="admin-card p-6">
            <div className="flex items-center space-x-3 mb-4">
              <Store className="w-5 h-5 text-primary-600" />
              <h3 className="text-lg font-semibold text-text-primary">Store Operations</h3>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Free Shipping Threshold ($)</label>
                <Input
                  type="number"
                  value={storeSettings.free_shipping_threshold}
                  onChange={(e) => setStoreSettings(prev => ({ ...prev, free_shipping_threshold: parseInt(e.target.value) || 0 }))}
                  className="admin-input"
                  placeholder="75"
                />
                <p className="text-xs text-text-muted mt-1">Orders over this amount get free shipping</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Default Tax Rate (%)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={storeSettings.tax_rate}
                  onChange={(e) => setStoreSettings(prev => ({ ...prev, tax_rate: parseFloat(e.target.value) || 0 }))}
                  className="admin-input"
                  placeholder="8.25"
                />
                <p className="text-xs text-text-muted mt-1">Applied to taxable items</p>
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-text-secondary">Auto-fulfill Orders</label>
                  <p className="text-xs text-text-muted">Automatically mark orders as fulfilled</p>
                </div>
                <Switch
                  checked={storeSettings.auto_fulfill_orders}
                  onCheckedChange={(checked) => setStoreSettings(prev => ({ ...prev, auto_fulfill_orders: checked }))}
                />
              </div>
            </div>
          </Card>

          <Card className="admin-card p-6">
            <div className="flex items-center space-x-3 mb-4">
              <Globe className="w-5 h-5 text-state-success" />
              <h3 className="text-lg font-semibold text-text-primary">Store Information</h3>
            </div>
            
            <div className="bg-surface border border-border-default rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <AlertCircle className="w-4 h-4 text-state-info" />
                <span className="text-sm font-medium text-state-info">Store Identity</span>
              </div>
              <p className="text-sm text-text-secondary leading-relaxed">
                Store name, contact information, and branding are configured during initial setup. 
                These are typically one-time settings that don&rsquo;t need frequent changes.
              </p>
              <div className="mt-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Store Name:</span>
                  <span className="text-text-primary font-medium">BeauTeas</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Currency:</span>
                  <span className="text-text-primary font-medium">USD</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Contact:</span>
                  <span className="text-text-primary font-medium">{brand.contact.email}</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Shipping Settings */}
      {activeTab === "shipping" && (
        <div className="space-y-6">
          <Card className="admin-card p-6">
            <div className="flex items-center space-x-3 mb-4">
              <DollarSign className="w-5 h-5 text-state-info" />
              <h3 className="text-lg font-semibold text-text-primary">Shipping by Quantity</h3>
            </div>

            <p className="text-sm text-text-muted mb-4">
              Cost in dollars for an order up to and including that many boxes. Bounds
              are inclusive; a row with no upper bound covers everything above the
              rest. When this list is non-empty it REPLACES the per-method cost below
              entirely. Leave it empty to keep the flat rates in force.
            </p>

            {shippingSettings.tiers.length === 0 ? (
              <p className="text-sm text-text-muted italic mb-4">
                Not configured. The flat per-method rates below are in effect.
              </p>
            ) : (
              <>
                {hasZeroCostTier(shippingSettings.tiers) && (
                  <div className="bg-state-warning-bg border border-state-warning rounded-lg p-3 mb-4">
                    <div className="flex items-center space-x-2">
                      <AlertCircle className="w-4 h-4 text-state-warning flex-shrink-0" />
                      <p className="text-sm text-state-warning">
                        A tier priced at $0.00 ships that entire band free. Confirm that&rsquo;s intentional before saving.
                      </p>
                    </div>
                  </div>
                )}

                {hasNoOpenEndedTier(shippingSettings.tiers) && (
                  <div className="bg-state-warning-bg border border-state-warning rounded-lg p-3 mb-4">
                    <div className="flex items-center space-x-2">
                      <AlertCircle className="w-4 h-4 text-state-warning flex-shrink-0" />
                      <p className="text-sm text-state-warning">
                        No tier has &ldquo;No upper bound&rdquo; checked. Orders larger than the
                        biggest tier are charged that biggest tier&rsquo;s price. Add an
                        open-ended row if bigger orders should cost more.
                      </p>
                    </div>
                  </div>
                )}

                <div className="space-y-2 mb-4">
                  {shippingSettings.tiers.map((tier, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-3">
                      <span className="text-sm w-32 text-text-secondary">
                        {tier.max_boxes === null ? 'More than above' : `Up to ${tier.max_boxes} boxes`}
                      </span>
                      {tier.max_boxes !== null && (
                        <Input
                          type="number"
                          min={1}
                          value={tier.max_boxes}
                          onChange={(e) => {
                            const tiers = [...shippingSettings.tiers];
                            tiers[i] = { ...tiers[i], max_boxes: parseInt(e.target.value, 10) || 1 };
                            setShippingSettings(prev => ({ ...prev, tiers }));
                          }}
                          className="w-24 admin-input"
                          aria-label={`Tier ${i + 1} maximum boxes`}
                        />
                      )}
                      <label className="flex items-center gap-1 text-xs text-text-muted whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={tier.max_boxes === null}
                          onChange={(e) => {
                            // At most one tier can be open-ended — checking this
                            // clears max_boxes on any other row that was too, so
                            // resolveShippingTier is never handed an ambiguous set.
                            setShippingSettings(prev => ({
                              ...prev,
                              tiers: setOpenEndedTier(prev.tiers, i, e.target.checked)
                            }));
                          }}
                        />
                        No upper bound
                      </label>
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-text-muted">$</span>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={tier.cost}
                          onChange={(e) => {
                            const tiers = [...shippingSettings.tiers];
                            // `min={0}` is HTML-only — it doesn't stop `-5` from
                            // being typed, and `parseFloat("-5") || 0` keeps -5
                            // since it's truthy. Clamp so a negative cost can
                            // never reach the customer-facing quote.
                            tiers[i] = { ...tiers[i], cost: Math.max(0, parseFloat(e.target.value) || 0) };
                            setShippingSettings(prev => ({ ...prev, tiers }));
                          }}
                          className="w-24 admin-input"
                          aria-label={`Tier ${i + 1} cost in dollars`}
                        />
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setShippingSettings(prev => ({ ...prev, tiers: removeTierRow(prev.tiers, i) }))}
                        className="h-7"
                        aria-label={`Remove tier ${i + 1}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShippingSettings(prev => ({ ...prev, tiers: addTierRow(prev.tiers) }))}
              className="border-secondary-400 text-secondary-600 hover:bg-secondary-500 hover:text-text-inverse"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Tier
            </Button>
          </Card>

          <Card className="admin-card p-6">
            <div className="flex items-center space-x-3 mb-4">
              <Zap className="w-5 h-5 text-state-info" />
              <h3 className="text-lg font-semibold text-text-primary">Shipping Methods</h3>
            </div>

            <div className="space-y-4">
              {shippingSettings.methods.map((method, index) => (
                <div key={method.id} className="bg-surface border border-border-default rounded-lg p-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-2">Method Name</label>
                      <Input
                        value={method.label}
                        onChange={(e) => {
                          const updated = [...shippingSettings.methods];
                          updated[index].label = e.target.value;
                          setShippingSettings(prev => ({ ...prev, methods: updated }));
                        }}
                        className="admin-input"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-2">Cost ($)</label>
                      <Input
                        type="number"
                        step="0.01"
                        value={method.cost}
                        onChange={(e) => {
                          const updated = [...shippingSettings.methods];
                          updated[index].cost = parseFloat(e.target.value) || 0;
                          setShippingSettings(prev => ({ ...prev, methods: updated }));
                        }}
                        className="admin-input"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-2">Delivery Days</label>
                      <Input
                        type="number"
                        value={method.estimatedDays}
                        onChange={(e) => {
                          const updated = [...shippingSettings.methods];
                          updated[index].estimatedDays = parseInt(e.target.value) || 1;
                          setShippingSettings(prev => ({ ...prev, methods: updated }));
                        }}
                        className="admin-input"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-sm font-medium text-text-secondary">Enabled</label>
                      </div>
                      <Switch
                        checked={method.enabled}
                        onCheckedChange={(checked) => {
                          const updated = [...shippingSettings.methods];
                          updated[index].enabled = checked;
                          setShippingSettings(prev => ({ ...prev, methods: updated }));
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Refund Settings */}
      {activeTab === "refunds" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="admin-card p-6">
            <div className="flex items-center space-x-3 mb-4">
              <RefreshCw className="w-5 h-5 text-state-success" />
              <h3 className="text-lg font-semibold text-text-primary">Return Policies</h3>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Return Window (Days)</label>
                <Input
                  type="number"
                  value={refundSettings.return_window_days}
                  onChange={(e) => setRefundSettings(prev => ({ ...prev, return_window_days: parseInt(e.target.value) || 30 }))}
                  className="admin-input"
                />
                <p className="text-xs text-text-muted mt-1">How long customers have to return items</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Restocking Fee (%)</label>
                <Input
                  type="number"
                  max="15"
                  value={refundSettings.restocking_fee_percent}
                  onChange={(e) => setRefundSettings(prev => ({ ...prev, restocking_fee_percent: Math.min(15, parseInt(e.target.value) || 0) }))}
                  className="admin-input"
                />
                <p className="text-xs text-text-muted mt-1">Fee charged for processing returns (max 15%)</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Minimum Refund Amount ($)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={refundSettings.minimum_refund_amount / 100}
                  onChange={(e) => setRefundSettings(prev => ({ ...prev, minimum_refund_amount: Math.round((parseFloat(e.target.value) || 0) * 100) }))}
                  className="admin-input"
                />
                <p className="text-xs text-text-muted mt-1">Minimum amount to process a refund</p>
              </div>
            </div>
          </Card>

          <Card className="admin-card p-6">
            <div className="flex items-center space-x-3 mb-4">
              <DollarSign className="w-5 h-5 text-state-error" />
              <h3 className="text-lg font-semibold text-text-primary">Shipping Refunds</h3>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-text-secondary">Refund Shipping - Full Returns</label>
                  <p className="text-xs text-text-muted">Refund shipping costs when entire order returned</p>
                </div>
                <Switch
                  checked={refundSettings.shipping_refunded_full}
                  onCheckedChange={(checked) => setRefundSettings(prev => ({ ...prev, shipping_refunded_full: checked }))}
                />
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-text-secondary">Refund Shipping - Partial Returns</label>
                  <p className="text-xs text-text-muted">Refund shipping costs on partial returns</p>
                </div>
                <Switch
                  checked={refundSettings.shipping_refunded_partial}
                  onCheckedChange={(checked) => setRefundSettings(prev => ({ ...prev, shipping_refunded_partial: checked }))}
                />
              </div>

              {/* BMC-213: refunds issued outside the app (Stripe Dashboard) are
                  reconciled into the ledger by the charge.refunded webhook.
                  Whether they also restore stock is a business decision. */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-text-secondary">Restock on Stripe Dashboard Refunds</label>
                  <p className="text-xs text-text-muted">Restore inventory when a full refund is issued outside the app. Partial ones never restock, since Stripe refunds an amount, not items.</p>
                </div>
                <Switch
                  checked={refundSettings.restock_on_external_refund}
                  onCheckedChange={(checked) => setRefundSettings(prev => ({ ...prev, restock_on_external_refund: checked }))}
                />
              </div>

              <div className="bg-state-warning-bg border border-state-warning rounded-lg p-3 mt-4">
                <div className="flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-state-warning flex-shrink-0" />
                  <div className="text-sm text-state-warning">
                    <p className="font-medium">Industry Standard</p>
                    <p className="text-xs text-state-warning mt-1">
                      Most stores do not refund shipping costs to encourage careful purchasing decisions.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Promotions Settings */}
      {activeTab === "promotions" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="admin-card p-6">
            <div className="flex items-center space-x-3 mb-4">
              <DollarSign className="w-5 h-5 text-secondary-600" />
              <h3 className="text-lg font-semibold text-text-primary">Site-wide Promotions</h3>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Global Discount (%)</label>
                <Input
                  type="number"
                  max="50"
                  value={promotionSettings.site_wide_discount_percent}
                  onChange={(e) => setPromotionSettings(prev => ({ ...prev, site_wide_discount_percent: Math.min(50, parseInt(e.target.value) || 0) }))}
                  className="admin-input"
                />
                <p className="text-xs text-text-muted mt-1">Applied to all products (max 50%)</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">New Customer Discount (%)</label>
                <Input
                  type="number"
                  max="25"
                  value={promotionSettings.new_customer_discount}
                  onChange={(e) => setPromotionSettings(prev => ({ ...prev, new_customer_discount: Math.min(25, parseInt(e.target.value) || 0) }))}
                  className="admin-input"
                />
                <p className="text-xs text-text-muted mt-1">First-time buyer discount (max 25%)</p>
              </div>
            </div>
          </Card>

          <Card className="admin-card p-6">
            <div className="flex items-center space-x-3 mb-4">
              <AlertCircle className="w-5 h-5 text-primary-600" />
              <h3 className="text-lg font-semibold text-text-primary">Promotional Banner</h3>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-text-secondary">Show Banner</label>
                  <p className="text-xs text-text-muted">Display promotional message site-wide</p>
                </div>
                <Switch
                  checked={promotionSettings.banner_enabled}
                  onCheckedChange={(checked) => setPromotionSettings(prev => ({ ...prev, banner_enabled: checked }))}
                />
              </div>
              
              {promotionSettings.banner_enabled && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">Banner Text</label>
                    <Textarea
                      value={promotionSettings.banner_text}
                      onChange={(e) => setPromotionSettings(prev => ({ ...prev, banner_text: e.target.value }))}
                      className="admin-input"
                      rows={2}
                      placeholder="🎉 Special promotion message..."
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">Banner Style</label>
                    <select
                      value={promotionSettings.banner_type}
                      onChange={(e) => setPromotionSettings(prev => ({ ...prev, banner_type: e.target.value as any }))}
                      className="w-full px-3 py-2 admin-input rounded-md"
                    >
                      <option value="info">Info (Blue)</option>
                      <option value="success">Success (Green)</option>
                      <option value="warning">Warning (Yellow)</option>
                      <option value="error">Alert (Red)</option>
                    </select>
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Recommendations Settings */}
      {activeTab === "recommendations" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="admin-card p-6">
            <div className="flex items-center space-x-3 mb-4">
              <Bot className="w-5 h-5 text-primary-600" />
              <h3 className="text-lg font-semibold text-text-primary">Recommendation Strategy</h3>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Strategy</label>
                <select
                  value={recommendationSettings.strategy}
                  onChange={(e) => setRecommendationSettings(prev => ({ ...prev, strategy: e.target.value as 'deterministic' | 'ai_batch' }))}
                  className="w-full px-3 py-2 admin-input rounded-md"
                >
                  <option value="deterministic">Deterministic (rule-based, real-time)</option>
                  <option value="ai_batch">AI Batch (precomputed via Vectorize)</option>
                </select>
                <p className="text-xs text-text-muted mt-1">
                  {recommendationSettings.strategy === 'ai_batch'
                    ? 'Uses the precomputed product_recommendations table. Rebuild after catalog changes.'
                    : 'Computed on-the-fly from category, price, and attribute similarity.'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Number of Recommendations</label>
                <Input
                  type="number"
                  min="1"
                  max="12"
                  value={recommendationSettings.limit}
                  onChange={(e) => setRecommendationSettings(prev => ({ ...prev, limit: Math.min(12, Math.max(1, parseInt(e.target.value) || 1)) }))}
                  className="admin-input"
                />
                <p className="text-xs text-text-muted mt-1">Products shown in the PDP recommendations strip (1–12)</p>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-text-secondary">Personalize</label>
                  <p className="text-xs text-text-muted">Reserve a slot for logged-in customers based on order history</p>
                </div>
                <Switch
                  checked={recommendationSettings.personalize}
                  onCheckedChange={(checked) => setRecommendationSettings(prev => ({ ...prev, personalize: checked }))}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-text-secondary">Exclude Owned Products</label>
                  <p className="text-xs text-text-muted">Hide products the customer has already purchased</p>
                </div>
                <Switch
                  checked={recommendationSettings.exclude_owned}
                  onCheckedChange={(checked) => setRecommendationSettings(prev => ({ ...prev, exclude_owned: checked }))}
                />
              </div>
            </div>
          </Card>

          <Card className="admin-card p-6">
            <div className="flex items-center space-x-3 mb-4">
              <Database className="w-5 h-5 text-state-info" />
              <h3 className="text-lg font-semibold text-text-primary">AI Batch Recommendations</h3>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-text-secondary leading-relaxed">
                Precomputes similar-product recommendations into the <code className="text-xs">product_recommendations</code> table using Vectorize. Only used when strategy is set to AI Batch. Rebuild after significant catalog changes.
              </p>

              {recRebuildSummary && (
                <div className="bg-surface border border-border-default rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-secondary">Products Processed</span>
                    <span className="text-text-primary font-medium">{recRebuildSummary.productsProcessed}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-secondary">Rows Written</span>
                    <span className="text-text-primary font-medium">{recRebuildSummary.rowsWritten}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-secondary">Duration</span>
                    <span className="text-text-primary font-medium">{(recRebuildSummary.durationMs / 1000).toFixed(1)}s</span>
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-border-default">
                <Button
                  onClick={triggerRecommendationsRebuild}
                  disabled={recRebuildLoading}
                  variant="outline"
                  className="w-full border-secondary-400 text-secondary-600 hover:bg-secondary-500 hover:text-text-inverse"
                >
                  {recRebuildLoading ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  Rebuild Recommendations
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Social Media Settings */}
      {activeTab === "social" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="admin-card p-6">
            <div className="flex items-center space-x-3 mb-4">
              <Share2 className="w-5 h-5 text-state-info" />
              <h3 className="text-lg font-semibold text-text-primary">Social Media Links</h3>
            </div>
            
            <p className="text-text-secondary mb-6">
              Manage social media links displayed in your site footer. Leave empty to hide specific platforms.
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Instagram</label>
                <Input
                  type="url"
                  value={socialMediaSettings.instagram}
                  onChange={(e) => setSocialMediaSettings(prev => ({ ...prev, instagram: e.target.value }))}
                  className="admin-input"
                  placeholder="https://instagram.com/yourusername"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">YouTube</label>
                <Input
                  type="url"
                  value={socialMediaSettings.youtube}
                  onChange={(e) => setSocialMediaSettings(prev => ({ ...prev, youtube: e.target.value }))}
                  className="admin-input"
                  placeholder="https://youtube.com/@yourchannel"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">LinkedIn</label>
                <Input
                  type="url"
                  value={socialMediaSettings.linkedin}
                  onChange={(e) => setSocialMediaSettings(prev => ({ ...prev, linkedin: e.target.value }))}
                  className="admin-input"
                  placeholder="https://linkedin.com/company/yourcompany"
                />
              </div>
            </div>
          </Card>

          <Card className="admin-card p-6">
            <div className="flex items-center space-x-3 mb-4">
              <Globe className="w-5 h-5 text-state-success" />
              <h3 className="text-lg font-semibold text-text-primary">Additional Platforms</h3>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Twitter (X)</label>
                <Input
                  type="url"
                  value={socialMediaSettings.twitter}
                  onChange={(e) => setSocialMediaSettings(prev => ({ ...prev, twitter: e.target.value }))}
                  className="admin-input"
                  placeholder="https://twitter.com/yourusername"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Facebook</label>
                <Input
                  type="url"
                  value={socialMediaSettings.facebook}
                  onChange={(e) => setSocialMediaSettings(prev => ({ ...prev, facebook: e.target.value }))}
                  className="admin-input"
                  placeholder="https://facebook.com/yourpage"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">TikTok</label>
                <Input
                  type="url"
                  value={socialMediaSettings.tiktok}
                  onChange={(e) => setSocialMediaSettings(prev => ({ ...prev, tiktok: e.target.value }))}
                  className="admin-input"
                  placeholder="https://tiktok.com/@yourusername"
                />
              </div>
            </div>

            <div className="bg-state-info-bg border border-state-info rounded-lg p-4 mt-6">
              <div className="flex items-start space-x-3">
                <CheckCircle className="w-5 h-5 text-state-info mt-0.5" />
                <div>
                  <h5 className="text-state-info font-medium mb-2">Footer Integration:</h5>
                  <ul className="text-state-info text-sm space-y-1 list-disc list-inside">
                    <li>Links appear automatically in the footer when provided</li>
                    <li>Empty links are hidden from display</li>
                    <li>All links open in new tabs for better user experience</li>
                    <li>Changes are applied immediately after saving</li>
                  </ul>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Admin Users Management */}
      {activeTab === "admins" && (
        <div className="grid grid-cols-1 gap-6">
          <Card className="admin-card p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <Shield className="w-5 h-5 text-state-info" />
                <h3 className="text-lg font-semibold text-text-primary">Admin Users</h3>
              </div>
              <Badge variant="secondary">
                {adminUsers.length} {adminUsers.length === 1 ? 'Admin' : 'Admins'}
              </Badge>
            </div>
            
            <p className="text-text-secondary mb-6">
              Manage users who have access to the admin panel. Admin users can view and modify all store data.
            </p>

            {/* Current Admin Users */}
            <div className="space-y-4 mb-6">
              <h4 className="text-md font-semibold text-text-primary">Current Admin Users</h4>
              {adminUsersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-5 h-5 animate-spin text-text-secondary" />
                  <span className="ml-2 text-text-secondary">Loading admin users...</span>
                </div>
              ) : adminUsers.length === 0 ? (
                <div className="text-text-secondary py-4 text-center">
                  No admin users found. This shouldn&rsquo;t happen - there should always be at least one admin.
                </div>
              ) : (
                <div className="space-y-2">
                  {adminUsers.map((userId, index) => (
                    <div key={userId} className="flex items-center justify-between bg-surface p-3 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <Shield className="w-4 h-4 text-state-info" />
                        <code className="text-sm font-mono text-text-primary">{userId}</code>
                        {index === 0 && (
                          <Badge variant="outline" className="text-xs">
                            Primary
                          </Badge>
                        )}
                      </div>
                      {adminUsers.length > 1 && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => removeAdminUser(userId)}
                          className="h-7"
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add New Admin User */}
            <div className="border-t border-border-default pt-6">
              <h4 className="text-md font-semibold text-text-primary mb-4">Add New Admin User</h4>
              <div className="flex space-x-3">
                <div className="flex-1">
                  <Input
                    value={newUserId}
                    onChange={(e) => setNewUserId(e.target.value)}
                    placeholder="user_xxxxxxxxxxxxxxxxx"
                    className="admin-input font-mono text-sm"
                  />
                  <p className="text-xs text-text-muted mt-1">
                    Enter the Clerk User ID (starts with &quot;user_&quot;)
                  </p>
                </div>
                <Button
                  onClick={addAdminUser}
                  disabled={!newUserId.trim()}
                >
                  Add Admin
                </Button>
              </div>
            </div>

            {/* Instructions */}
            <div className="bg-state-info-bg border border-state-info rounded-lg p-4 mt-6">
              <div className="flex items-start space-x-3">
                <CheckCircle className="w-5 h-5 text-state-info mt-0.5" />
                <div>
                  <h5 className="text-state-info font-medium mb-2">Database-Based Management:</h5>
                  <ul className="text-state-info text-sm space-y-1 list-disc list-inside">
                    <li>Changes are applied immediately to the database</li>
                    <li>User IDs can be found in the Clerk Dashboard under Users</li>
                    <li>There must always be at least one admin user</li>
                    <li>Admin users have full access to all store data and settings</li>
                  </ul>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* All tabs implemented above */}
    </div>
  );
}

{/* Legacy sections removed - replaced with functional settings */}

