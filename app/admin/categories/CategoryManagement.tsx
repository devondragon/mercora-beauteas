"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { 
  Search, Plus, Edit, Trash2, Move, ChevronDown, ChevronRight,
  Tag, FolderOpen, Package, ArrowUpDown, Eye, Upload, X, ImageIcon, RefreshCw
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { Category } from "@/lib/types";

interface CategoryTreeProps {
  categories: Category[];
  allCategories: Category[];
  onEdit: (category: Category) => void;
  onDelete: (id: string) => void;
  onMove: (categoryId: string, direction: 'up' | 'down') => void;
  level?: number;
}

function CategoryTree({ categories, allCategories, onEdit, onDelete, onMove, level = 0 }: CategoryTreeProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  
  const toggleExpanded = (categoryId: string) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };

  const getCategoryName = (category: Category): string => {
    return typeof category.name === 'string' ? category.name : Object.values(category.name)[0] || '';
  };

  const hasChildren = (category: Category): boolean => {
    return allCategories.some(child => child.parent_id === category.id);
  };

  const getChildCategories = (parentId: string): Category[] => {
    return allCategories.filter(cat => cat.parent_id === parentId);
  };

  return (
    <div className={`space-y-2 ${level > 0 ? 'ml-6 border-l border-border-default pl-4' : ''}`}>
      {categories.map((category) => (
        <div key={category.id} className="space-y-2">
          <div className="flex items-center justify-between p-3 admin-card rounded-lg border">
            <div className="flex items-center space-x-3">
              {hasChildren(category) ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleExpanded(category.id)}
                  className="p-0 h-auto text-text-secondary hover:text-text-primary"
                >
                  {expandedCategories.has(category.id) ? 
                    <ChevronDown className="w-4 h-4" /> : 
                    <ChevronRight className="w-4 h-4" />
                  }
                </Button>
              ) : (
                <div className="w-4 h-4" /> // Spacer
              )}
              
              <div className="w-8 h-8 bg-primary-500/20 rounded-md overflow-hidden flex items-center justify-center">
                {(() => {
                  // Extract primary image URL from category
                  const getPrimaryImageUrl = () => {
                    if (!category.primary_image) return null;
                    
                    try {
                      let imageData = category.primary_image;
                      
                      // Parse JSON string if needed
                      if (typeof imageData === "string" && (imageData as string).startsWith("{")) {
                        try {
                          imageData = JSON.parse(imageData);
                        } catch {
                          return null;
                        }
                      }
                      
                      // Handle MACH structure (file.url)
                      if (imageData?.file?.url) {
                        return imageData.file.url;
                      }
                      
                      // Handle flat structure (url) - for legacy data
                      if ((imageData as any)?.url) {
                        return (imageData as any).url;
                      }
                      
                      return null;
                    } catch {
                      return null;
                    }
                  };

                  const imageUrl = getPrimaryImageUrl();
                  
                  if (imageUrl) {
                    return (
                      <Image
                        src={imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`}
                        alt={getCategoryName(category)}
                        width={32}
                        height={32}
                        className="object-cover rounded-md"
                        sizes="32px"
                      />
                    );
                  }
                  
                  return <FolderOpen className="w-4 h-4 text-primary-600" />;
                })()}
              </div>

              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-medium text-text-primary">{getCategoryName(category)}</span>
                  <Badge variant={category.status === 'active' ? 'default' : 'secondary'}>
                    {category.status || 'active'}
                  </Badge>
                  {category.product_count !== undefined && (
                    <Badge variant="outline" className="text-xs">
                      <Package className="w-3 h-3 mr-1" />
                      {category.product_count}
                    </Badge>
                  )}
                </div>
                <div className="text-sm text-text-secondary">
                  ID: {category.id} • Path: {category.path || '/'}
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.open(`/admin/categories/${category.id}`, '_blank')}
                className="text-state-info hover:text-state-info hover:bg-state-info-bg"
                title="View category products"
              >
                <Eye className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit(category)}
                className="text-primary-700 hover:text-primary-800"
              >
                <Edit className="w-4 h-4" />
              </Button>
              <div className="flex items-center space-x-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onMove(category.id, 'up')}
                  className="text-text-muted hover:text-text-secondary p-1"
                  title="Move category up"
                >
                  <ArrowUpDown className="w-3 h-3 rotate-180" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onMove(category.id, 'down')}
                  className="text-text-muted hover:text-text-secondary p-1"
                  title="Move category down"
                >
                  <ArrowUpDown className="w-3 h-3" />
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDelete(category.id)}
                className="text-state-error hover:text-state-error hover:bg-state-error-bg"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
          
          {hasChildren(category) && expandedCategories.has(category.id) && (
            <CategoryTree
              categories={getChildCategories(category.id)}
              allCategories={allCategories}
              onEdit={onEdit}
              onDelete={onDelete}
              onMove={onMove}
              level={level + 1}
            />
          )}
        </div>
      ))}
    </div>
  );
}

interface CategoryEditorProps {
  category: Category | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (category: Partial<Category>) => Promise<void>;
  isNew?: boolean;
  allCategories: Category[];
}

function CategoryEditor({ category, isOpen, onClose, onSave, isNew = false, allCategories }: CategoryEditorProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [slug, setSlug] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [status, setStatus] = useState<"active" | "inactive" | "archived">("active");
  const [tags, setTags] = useState("");
  const [position, setPosition] = useState<number>(1);
  const [primaryImageUrl, setPrimaryImageUrl] = useState("");
  const [primaryImageAlt, setPrimaryImageAlt] = useState("");
  const [uploadingPrimary, setUploadingPrimary] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (category) {
      const categoryName = typeof category.name === 'string' ? category.name : Object.values(category.name)[0] || '';
      const categoryDesc = typeof category.description === 'string' ? category.description : Object.values(category.description || {})[0] || '';
      const categorySlug = typeof category.slug === 'string' ? category.slug : Object.values(category.slug || {})[0] || '';
      
      setName(categoryName);
      setDescription(categoryDesc);
      setSlug(categorySlug);
      setParentId(category.parent_id || "");
      setStatus(category.status || "active");
      setTags(category.tags?.join(", ") || "");
      setPosition(category.position || 1);
      
      // Load image data with both MACH and flat structure support
      const loadImageData = (imageField: any) => {
        if (!imageField) return { url: "", alt: "" };
        
        // Parse JSON string if needed
        let imageData = imageField;
        if (typeof imageField === "string" && imageField.startsWith("{")) {
          try {
            imageData = JSON.parse(imageField);
          } catch {
            return { url: "", alt: "" };
          }
        }
        
        // Handle MACH structure (file.url, accessibility.alt_text)
        if (imageData?.file?.url) {
          return {
            url: imageData.file.url,
            alt: imageData.accessibility?.alt_text || ""
          };
        }
        
        // Handle flat structure (url, alt_text)
        if (imageData?.url) {
          return {
            url: imageData.url,
            alt: imageData.alt_text || imageData.alt || ""
          };
        }
        
        return { url: "", alt: "" };
      };
      
      const primaryImage = loadImageData(category.primary_image);
      setPrimaryImageUrl(primaryImage.url);
      setPrimaryImageAlt(primaryImage.alt);
    } else if (isNew) {
      setName("");
      setDescription("");
      setSlug("");
      setParentId("");
      setStatus("active");
      setTags("");
      setPosition(1);
      setPrimaryImageUrl("");
      setPrimaryImageAlt("");
    }
  }, [category, isNew]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const categoryData: Partial<Category> = {
        name: name.trim(),
        description: description.trim() || undefined,
        slug: slug.trim() || undefined,
        parent_id: parentId || undefined,
        status,
        tags: tags.split(",").map(t => t.trim()).filter(Boolean),
        position,
        primary_image: primaryImageUrl.trim() ? {
          id: `img_${Date.now()}`,
          type: "image" as const,
          file: {
            url: primaryImageUrl.trim(),
            format: primaryImageUrl.trim().split('.').pop()?.toLowerCase() || "jpg"
          },
          accessibility: {
            alt_text: primaryImageAlt.trim() || name.trim()
          }
        } : undefined,
      };

      if (isNew) {
        categoryData.id = `cat_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      }

      await onSave(categoryData);
      onClose();
    } catch (error) {
      console.error("Error saving category:", error);
    } finally {
      setSaving(false);
    }
  };

  // Generate slug from name
  const generateSlug = () => {
    if (name) {
      const generatedSlug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      setSlug(generatedSlug);
    }
  };

  // Image upload functions
  const uploadImage = async (file: File, folder: 'products' | 'categories', filename: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', folder);
    formData.append('filename', filename);

    const response = await fetch('/api/admin/upload-image', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error((error as any).error || 'Upload failed');
    }

    return await response.json();
  };

  const generateR2Filename = (baseName: string, suffix: string) => {
    const cleanName = baseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const timestamp = Date.now();
    return `${cleanName}-${suffix}-${timestamp}`;
  };

  const handlePrimaryImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingPrimary(true);
    try {
      // Generate filename from category name
      const filename = generateR2Filename(name || 'category', 'primary');
      
      const result = await uploadImage(file, 'categories', filename);
      setPrimaryImageUrl((result as any).path); // Store the database path format (/categories/filename.jpg)
      
      // Reset the input
      event.target.value = '';
    } catch (error) {
      console.error('Upload failed:', error);
      alert(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setUploadingPrimary(false);
    }
  };

  if (!isOpen) return null;

  const rootCategories = allCategories.filter(cat => !cat.parent_id);

  return (
    <div className="fixed inset-0 bg-text-primary/50 flex items-center justify-center p-4 z-50">
      <Card className="admin-card w-full max-w-2xl max-h-[90vh] overflow-hidden">
        <div className="p-6 border-b border-border-default">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-text-primary">
              {isNew ? "Create New Category" : "Edit Category"}
            </h2>
            <Button variant="ghost" onClick={onClose} className="text-text-secondary">
              ✕
            </Button>
          </div>
        </div>
        
        <div className="p-6 overflow-y-auto max-h-[70vh] space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Name *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Category name..."
              className="admin-input"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Slug
            </label>
            <div className="flex space-x-2">
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="url-friendly-slug"
                className="admin-input flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={generateSlug}
                className="px-3"
              >
                Generate
              </Button>
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Description
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Category description..."
              rows={3}
              className="admin-input"
            />
          </div>

          {/* Primary Image Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-text-primary flex items-center">
              <ImageIcon className="w-4 h-4 mr-2" />
              Category Image
            </h3>
            
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Primary Image
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Input
                    value={primaryImageUrl}
                    onChange={(e) => setPrimaryImageUrl(e.target.value)}
                    placeholder="/categories/category-name.jpg or full URL"
                    className="admin-input"
                  />
                  <div className="text-xs text-text-secondary mt-1">
                    Path or URL for the main category image
                  </div>
                </div>
                <div>
                  <div className="relative">
                    <input
                      type="file"
                      accept="image/jpeg,image/jpg,image/png,image/webp"
                      onChange={handlePrimaryImageUpload}
                      className="hidden"
                      id="primary-image-upload"
                      disabled={uploadingPrimary}
                    />
                    <label
                      htmlFor="primary-image-upload"
                      className={`flex items-center justify-center px-4 py-2 border border-primary-500 rounded-md cursor-pointer transition-colors ${
                        uploadingPrimary
                          ? 'bg-primary-500/20 text-primary-700 cursor-not-allowed'
                          : 'text-primary-600 hover:bg-primary-500 hover:text-text-inverse'
                      }`}
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      {uploadingPrimary ? 'Uploading...' : 'Upload Image'}
                    </label>
                  </div>
                  <div className="text-xs text-text-secondary mt-1">
                    Upload to R2 bucket (JPEG, PNG, WebP, max 10MB)
                  </div>
                </div>
              </div>
              {primaryImageUrl && (
                <div className="mt-3">
                  <div className="relative w-32 h-32 rounded-lg overflow-hidden border border-border-default">
                    <Image
                      src={primaryImageUrl.startsWith("/") ? primaryImageUrl : `/${primaryImageUrl}`}
                      alt={primaryImageAlt || "Primary image preview"}
                      fill
                      className="object-cover"
                      sizes="128px"
                    />
                  </div>
                  <div className="text-xs text-text-muted mt-1">
                    Preview: {primaryImageUrl}
                  </div>
                </div>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Image Alt Text
              </label>
              <Input
                value={primaryImageAlt}
                onChange={(e) => setPrimaryImageAlt(e.target.value)}
                placeholder="Descriptive text for accessibility and SEO"
                className="admin-input"
              />
              <div className="text-xs text-text-secondary mt-1">
                Describe the image for screen readers and search engines
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Parent Category
              </label>
              <select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="w-full admin-input border rounded px-3 py-2"
              >
                <option value="">No Parent (Root Category)</option>
                {rootCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {typeof cat.name === 'string' ? cat.name : Object.values(cat.name)[0]}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as "active" | "inactive" | "archived")}
                className="w-full admin-input border rounded px-3 py-2"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Tags (comma-separated)
            </label>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="tag1, tag2, tag3"
              className="admin-input"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Position
            </label>
            <Input
              type="number"
              value={position}
              onChange={(e) => setPosition(parseInt(e.target.value) || 1)}
              min={1}
              className="admin-input"
            />
          </div>

          {!isNew && category && (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Products in Category
              </label>
              <div className="bg-surface border border-border-default rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-text-secondary">
                    {category.product_count || 0} products
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(`/admin/categories/${category.id}`, '_blank')}
                    className="text-xs"
                  >
                    Manage Products
                  </Button>
                </div>
                <p className="text-xs text-text-secondary">
                  Use the &quot;Manage Products&quot; button to add, remove, or organize products in this category.
                </p>
              </div>
            </div>
          )}
        </div>
        
        <div className="p-6 border-t border-border-default flex items-center justify-between">
          <div className="text-sm text-text-secondary">
            Categories help organize products for better navigation and discovery
          </div>
          <div className="flex items-center space-x-3">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="bg-primary-500 hover:bg-primary-600"
            >
              {saving ? "Saving..." : isNew ? "Create Category" : "Save Changes"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function CategoryManagement() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [filteredCategories, setFilteredCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [isNewCategory, setIsNewCategory] = useState(false);
  const [viewMode, setViewMode] = useState<"tree" | "list">("tree");
  const [refreshingCounts, setRefreshingCounts] = useState(false);

  const fetchCategories = async () => {
    try {
      // Exclude archived categories to prevent UI clutter
      const response = await fetch("/api/categories?include_inactive=true&exclude_archived=true");
      if (response.ok) {
        const result: any = await response.json();
        const categories: Category[] = result.data || [];

        setCategories(categories);
        setFilteredCategories(categories);
      } else {
        console.error("Failed to fetch categories:", response.status, response.statusText);
      }
    } catch (error) {
      console.error("Error fetching categories:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCategory = async (categoryData: Partial<Category>) => {
    try {
      const url = isNewCategory ? "/api/categories" : `/api/categories/${categoryData.id}`;
      const method = isNewCategory ? "POST" : "PUT";
      
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(categoryData),
      });

      if (response.ok) {
        const result = await response.json();
        await fetchCategories();
        // Show success notification
        alert(`Category "${categoryData.name}" ${isNewCategory ? 'created' : 'updated'} successfully!`);
      } else {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" })) as any;
        const errorMessage = errorData?.error || errorData?.message || "Failed to save category";
        alert(`Error saving category: ${errorMessage}`);
        throw new Error(errorMessage);
      }
    } catch (error) {
      if (error instanceof Error) {
        alert(`Error saving category: ${error.message}`);
      } else {
        alert("Error saving category: Unknown error occurred");
      }
      throw error;
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm("Are you sure you want to delete this category?")) return;
    
    try {
      const response = await fetch(`/api/categories/${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await fetchCategories();
      } else {
        const error: any = await response.json();
        alert("Failed to delete category: " + (error.error || "Unknown error"));
      }
    } catch (error) {
      alert("Failed to delete category");
    }
  };

  const handleMoveCategory = async (categoryId: string, direction: 'up' | 'down') => {
    const category = categories.find(cat => cat.id === categoryId);
    if (!category) return;
    
    // Get categories with the same parent
    const siblings = categories.filter(cat => cat.parent_id === category.parent_id)
                               .sort((a, b) => (a.position || 0) - (b.position || 0));
    
    const currentIndex = siblings.findIndex(cat => cat.id === categoryId);
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    
    if (targetIndex < 0 || targetIndex >= siblings.length) {
      alert(`Cannot move category ${direction} - already at the ${direction === 'up' ? 'top' : 'bottom'}`);
      return;
    }
    
    const targetCategory = siblings[targetIndex];
    const currentPosition = category.position || 0;
    const targetPosition = targetCategory.position || 0;
    
    try {
      // Swap positions
      await Promise.all([
        fetch(`/api/categories/${category.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ position: targetPosition })
        }),
        fetch(`/api/categories/${targetCategory.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ position: currentPosition })
        })
      ]);
      
      await fetchCategories(); // Refresh the list
    } catch (error) {
      console.error('Error moving category:', error);
      alert('Failed to move category');
    }
  };

  const openEditor = (category: Category | null = null, isNew = false) => {
    setSelectedCategory(category);
    setIsNewCategory(isNew);
    setShowEditor(true);
  };

  const closeEditor = () => {
    setShowEditor(false);
    setSelectedCategory(null);
    setIsNewCategory(false);
  };

  const refreshCategoryCounts = async () => {
    setRefreshingCounts(true);
    try {
      const response = await fetch("/api/admin/categories/refresh-counts", {
        method: "POST",
      });
      
      if (response.ok) {
        await fetchCategories(); // Reload categories with updated counts
      } else {
        alert("Failed to refresh category counts");
      }
    } catch (error) {
      alert("Failed to refresh category counts");
    } finally {
      setRefreshingCounts(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredCategories(categories);
      return;
    }

    const filtered = categories.filter((category) => {
      const name = typeof category.name === 'string' ? category.name : Object.values(category.name)[0] || '';
      const description = typeof category.description === 'string' ? category.description : Object.values(category.description || {})[0] || '';
      
      return (
        name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        category.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (category.tags && category.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase())))
      );
    });

    setFilteredCategories(filtered);
  }, [searchQuery, categories]);

  if (loading) {
    return <div className="text-text-secondary">Loading categories...</div>;
  }

  const rootCategories = filteredCategories.filter(cat => !cat.parent_id);
  
  // Categories are already flat now
  const totalCategories = categories.length;
  const activeCategories = categories.filter(cat => cat.status === 'active').length;
  const totalProducts = categories.reduce((sum, cat) => sum + (cat.product_count || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-secondary w-4 h-4" />
            <Input
              type="text"
              placeholder="Search categories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 w-64 admin-input"
            />
          </div>

          <div className="flex items-center space-x-2 bg-surface rounded-lg p-1">
            <Button
              variant={viewMode === 'tree' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('tree')}
              className="text-xs"
            >
              Tree View
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('list')}
              className="text-xs"
            >
              List View
            </Button>
          </div>
          
          <Button
            onClick={refreshCategoryCounts}
            disabled={refreshingCounts}
            variant="outline"
            className="border-state-success text-state-success hover:bg-state-success hover:text-text-inverse"
          >
            {refreshingCounts ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            {refreshingCounts ? "Refreshing..." : "Refresh Counts"}
          </Button>
        </div>
        
        <Button
          onClick={() => openEditor(null, true)}
          className="bg-primary-500 hover:bg-primary-600 text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Category
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="admin-card p-4">
          <div className="text-2xl font-bold text-text-primary">{totalCategories}</div>
          <div className="text-sm text-text-secondary">Total Categories</div>
        </Card>
        <Card className="admin-card p-4">
          <div className="text-2xl font-bold text-state-success">{activeCategories}</div>
          <div className="text-sm text-text-secondary">Active Categories</div>
        </Card>
        <Card className="admin-card p-4">
          <div className="text-2xl font-bold text-primary-600">{totalProducts}</div>
          <div className="text-sm text-text-secondary">Total Product Mappings</div>
        </Card>
        <Card className="admin-card p-4">
          <div className="text-2xl font-bold text-state-info">{rootCategories.length}</div>
          <div className="text-sm text-text-secondary">Root Categories</div>
        </Card>
      </div>

      {/* Categories Display */}
      {viewMode === 'tree' ? (
        <Card className="admin-card p-6">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Category Hierarchy</h3>
          {filteredCategories.length === 0 && !loading ? (
            <div className="text-center py-8 text-text-secondary">
              {searchQuery ? "No categories found matching your search." : "No categories available."}
            </div>
          ) : (
            <CategoryTree
              categories={rootCategories}
              allCategories={filteredCategories}
              onEdit={openEditor}
              onDelete={handleDeleteCategory}
              onMove={handleMoveCategory}
            />
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCategories.map((category) => {
            const name = typeof category.name === 'string' ? category.name : Object.values(category.name)[0] || '';
            return (
              <Card key={category.id} className="admin-card p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 bg-primary-500/20 rounded-lg overflow-hidden flex items-center justify-center">
                    {(() => {
                      // Extract primary image URL from category
                      const getPrimaryImageUrl = () => {
                        if (!category.primary_image) return null;
                        
                        try {
                          let imageData = category.primary_image;
                          
                          // Parse JSON string if needed
                          if (typeof imageData === "string" && (imageData as string).startsWith("{")) {
                            try {
                              imageData = JSON.parse(imageData);
                            } catch {
                              return null;
                            }
                          }
                          
                          // Handle MACH structure (file.url)
                          if (imageData?.file?.url) {
                            return imageData.file.url;
                          }
                          
                          // Handle flat structure (url) - for legacy data
                          if ((imageData as any)?.url) {
                            return (imageData as any).url;
                          }
                          
                          return null;
                        } catch {
                          return null;
                        }
                      };

                      const imageUrl = getPrimaryImageUrl();
                      const name = typeof category.name === 'string' ? category.name : Object.values(category.name)[0] || '';
                      
                      if (imageUrl) {
                        return (
                          <Image
                            src={imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`}
                            alt={name}
                            width={40}
                            height={40}
                            className="object-cover rounded-lg"
                            sizes="40px"
                          />
                        );
                      }
                      
                      return <FolderOpen className="w-5 h-5 text-primary-600" />;
                    })()}
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge variant={category.status === 'active' ? 'default' : 'secondary'}>
                      {category.status || 'active'}
                    </Badge>
                  </div>
                </div>

                <h3 className="text-lg font-semibold text-text-primary mb-2">{name}</h3>
                <p className="text-sm text-text-secondary mb-3">{category.path || '/'}</p>

                <div className="flex items-center justify-between">
                  <div className="flex items-center text-xs text-text-muted">
                    <Package className="w-3 h-3 mr-1" />
                    {category.product_count || 0} products
                  </div>

                  <div className="flex items-center space-x-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => router.push(`/admin/categories/${category.id}`)}
                      className="text-state-info hover:text-state-info hover:bg-state-info-bg"
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditor(category)}
                      className="text-primary-700 hover:text-primary-800"
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteCategory(category.id)}
                      className="text-state-error hover:text-state-error hover:bg-state-error-bg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Category Editor Modal */}
      <CategoryEditor
        category={selectedCategory}
        isOpen={showEditor}
        onClose={closeEditor}
        onSave={handleSaveCategory}
        isNew={isNewCategory}
        allCategories={categories}
      />
    </div>
  );
}
