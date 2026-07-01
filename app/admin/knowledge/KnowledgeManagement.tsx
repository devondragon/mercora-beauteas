"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { 
  Search, Plus, Edit, Trash2, Bot, RefreshCw, FileText, 
  Upload, Download, Eye, Calendar, Sparkles, Wand2
} from "lucide-react";
import Image from "next/image";

interface KnowledgeArticle {
  filename: string;
  title: string;
  content: string;
  lastModified: string;
  size: number;
  isVectorized?: boolean;
}

interface ArticleEditorProps {
  article: KnowledgeArticle | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (article: Partial<KnowledgeArticle>) => Promise<void>;
  isNew?: boolean;
}

function ArticleEditor({ article, isOpen, onClose, onSave, isNew = false }: ArticleEditorProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [filename, setFilename] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAiAssistant, setShowAiAssistant] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [generatingContent, setGeneratingContent] = useState(false);

  useEffect(() => {
    if (article) {
      setTitle(article.title);
      setContent(article.content);
      setFilename(article.filename);
    } else if (isNew) {
      setTitle("");
      setContent("");
      setFilename("");
    }
  }, [article, isNew]);

  const generateFilename = () => {
    if (title.trim()) {
      const generatedFilename = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-') // Replace multiple hyphens with single
        .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
        + '.md';
      setFilename(generatedFilename);
    }
  };

  const generateAiContent = async () => {
    if (!aiPrompt.trim() || !title.trim()) {
      alert('Please provide both a title and a description of what you want to write about.');
      return;
    }

    setGeneratingContent(true);
    try {
      const response = await fetch('/api/admin/generate-article', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: title.trim(),
          prompt: aiPrompt.trim(),
        }),
      });

      if (response.ok) {
        const result = await response.json() as any;
        setContent(result?.content || result?.markdown || result?.text || '');
        setShowAiAssistant(false);
        setAiPrompt('');
      } else {
        const error = await response.json() as any;
        alert(`Failed to generate content: ${error?.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error generating AI content:', error);
      alert('Failed to generate content. Please try again.');
    } finally {
      setGeneratingContent(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        title,
        content,
        filename: filename || `${title.toLowerCase().replace(/\s+/g, '-')}.md`
      });
      onClose();
    } catch (error) {
      console.error("Error saving article:", error);
      alert('Failed to save article. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-text-primary/50 flex items-center justify-center p-4 z-50">
      <Card className="admin-card w-full max-w-4xl max-h-[90vh] overflow-hidden">
        <div className="p-6 border-b border-border-default">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-text-primary">
              {isNew ? "Create New Article" : "Edit Article"}
            </h2>
            <Button variant="ghost" onClick={onClose} className="text-text-secondary">
              ✕
            </Button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[70vh]">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Title *
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Article title..."
                className="admin-input"
                required
              />
              {!title.trim() && (
                <p className="text-xs text-state-error mt-1">Title is required</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Filename
              </label>
              <div className="flex space-x-2">
                <Input
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="filename.md"
                  className="admin-input flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={generateFilename}
                  disabled={!title.trim()}
                  className="px-3 border-primary-500 text-primary-600 hover:bg-primary-500 hover:text-text-inverse"
                  title="Generate filename from title"
                >
                  Generate
                </Button>
              </div>
              <p className="text-xs text-text-secondary mt-1">Auto-generated from title if left empty</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-text-secondary">
                  Content (Markdown)
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAiAssistant(true)}
                  className="border-secondary-400 text-secondary-600 hover:bg-secondary-400 hover:text-text-inverse"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Chai AI Assist
                </Button>
              </div>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="# Article Title\n\nYour content here...\n\nOr click 'Chai AI Assist' above for AI-powered content generation!"
                rows={20}
                className="admin-input font-mono text-sm"
              />

              {/* AI Assistant Dialog */}
              {showAiAssistant && (
                <div className="fixed inset-0 bg-text-primary/60 flex items-center justify-center p-4 z-[60]">
                  <Card className="admin-card border-secondary-400/30 w-full max-w-lg">
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-gradient-to-br from-secondary-400 to-primary-500 rounded-lg flex items-center justify-center">
                            <Image
                              src="/volt.svg"
                              alt="Chai AI"
                              width={24}
                              height={24}
                            />
                          </div>
                          <div>
                            <h3 className="text-lg font-semibold text-text-primary">Chai AI Assistant</h3>
                            <p className="text-sm text-text-secondary">Knowledge article generation</p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowAiAssistant(false)}
                          className="text-text-secondary hover:text-text-primary"
                        >
                          ✕
                        </Button>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <p className="text-sm text-text-secondary mb-3">
                            Tell me a little about what you want me to know and I&rsquo;ll get us started with a comprehensive article!
                          </p>
                          <Textarea
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            placeholder="Describe what this article should cover...\n\nFor example:\n- A guide to brewing our calendula tea blends\n- Skincare benefits of organic botanicals\n- Product recommendations\n- Daily tea ritual tips\n- FAQ about organic skincare teas"
                            rows={6}
                            className="admin-input"
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <p className="text-xs text-text-muted">
                            Article title: <strong className="text-text-secondary">{title || 'Please add a title first'}</strong>
                          </p>
                          <div className="flex space-x-3">
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setShowAiAssistant(false);
                                setAiPrompt('');
                              }}
                              disabled={generatingContent}
                            >
                              Cancel
                            </Button>
                            <Button
                              onClick={generateAiContent}
                              disabled={generatingContent || !aiPrompt.trim() || !title.trim()}
                              className="bg-gradient-to-r from-secondary-400 to-primary-500 hover:from-secondary-500 hover:to-primary-600"
                            >
                              {generatingContent ? (
                                <>
                                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                  Generating...
                                </>
                              ) : (
                                <>
                                  <Wand2 className="w-4 h-4 mr-2" />
                                  Generate Content
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-border-default flex items-center justify-between">
          <div className="text-sm text-text-secondary">
            Changes will automatically trigger AI vectorization
          </div>
          <div className="flex items-center space-x-3">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !title.trim() || !content.trim()}
            >
              {saving ? "Saving..." : "Save Article"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function KnowledgeManagement() {
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [filteredArticles, setFilteredArticles] = useState<KnowledgeArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isVectorizing, setIsVectorizing] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<KnowledgeArticle | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [isNewArticle, setIsNewArticle] = useState(false);

  const fetchArticles = async () => {
    try {
      const response = await fetch("/api/admin/knowledge?token=beauteas-admin");
      if (response.ok) {
        const articles: KnowledgeArticle[] = await response.json();
        console.log("Loaded articles:", articles.length);
        setArticles(articles);
        setFilteredArticles(articles);
      } else {
        console.error("Failed to fetch articles:", response.status, response.statusText);
        const errorText = await response.text();
        console.error("Error response:", errorText);
      }
    } catch (error) {
      console.error("Error fetching articles:", error);
    } finally {
      setLoading(false);
    }
  };

  const triggerVectorization = async () => {
    setIsVectorizing(true);
    try {
      // Call admin vectorize endpoint (now uses session auth)
      const response = await fetch("/api/admin/vectorize");
      if (response.ok) {
        const result = await response.json() as any;
        console.log("Vectorization triggered successfully:", result?.message);
        // Show a success notification
        alert(`Vectorization complete! Indexed ${result?.summary?.totalIndexed || 0} items in ${(result?.executionTimeMs / 1000).toFixed(1)}s.`);
        // Refresh the articles list to update vectorization status
        await fetchArticles();
      } else {
        const error = await response.json() as any;
        throw new Error(error?.error || "Vectorization request failed");
      }
    } catch (error) {
      console.error("Error triggering vectorization:", error);
      alert("Failed to trigger vectorization: " + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsVectorizing(false);
    }
  };

  const handleSaveArticle = async (articleData: Partial<KnowledgeArticle>) => {
    try {
      console.log("Saving article:", articleData);
      const response = await fetch("/api/admin/knowledge?token=beauteas-admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filename: articleData.filename,
          title: articleData.title,
          content: articleData.content,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log("Article saved successfully:", result);
        // Refresh the articles list
        await fetchArticles();
      } else {
        const error: any = await response.json();
        console.error("Failed to save article:", error);
        throw new Error(error.error || "Failed to save article");
      }
    } catch (error) {
      console.error("Error saving article:", error);
      throw error; // Re-throw to handle in the editor
    }
  };

  const handleDelete = async (filename: string) => {
    if (!confirm("Are you sure you want to delete this article?")) return;
    
    try {
      const response = await fetch(`/api/admin/knowledge?filename=${encodeURIComponent(filename)}`, {
        method: "DELETE",
      });

      if (response.ok) {
        // Refresh the articles list
        await fetchArticles();
        console.log("Article deleted successfully");
      } else {
        const error: any = await response.json();
        console.error("Failed to delete article:", error);
        alert("Failed to delete article: " + (error.error || "Unknown error"));
      }
    } catch (error) {
      console.error("Error deleting article:", error);
      alert("Failed to delete article");
    }
  };

  const openEditor = (article: KnowledgeArticle | null = null, isNew = false) => {
    setSelectedArticle(article);
    setIsNewArticle(isNew);
    setShowEditor(true);
  };

  const closeEditor = () => {
    setShowEditor(false);
    setSelectedArticle(null);
    setIsNewArticle(false);
  };

  useEffect(() => {
    fetchArticles();
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredArticles(articles);
      return;
    }

    const filtered = articles.filter((article) =>
      article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      article.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      article.filename.toLowerCase().includes(searchQuery.toLowerCase())
    );

    setFilteredArticles(filtered);
  }, [searchQuery, articles]);

  if (loading) {
    return <div className="text-text-secondary">Loading knowledge base...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-secondary w-4 h-4" />
            <Input
              type="text"
              placeholder="Search articles..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 w-64 admin-input"
            />
          </div>
          <Button
            onClick={triggerVectorization}
            disabled={isVectorizing}
            variant="outline"
            className="border-primary-500 text-primary-600 hover:bg-primary-500 hover:text-text-inverse"
          >
            {isVectorizing ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Bot className="w-4 h-4 mr-2" />
            )}
            {isVectorizing ? "Vectorizing..." : "Reindex AI"}
          </Button>
        </div>
        <Button onClick={() => openEditor(null, true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Article
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="admin-card p-4">
          <div className="text-2xl font-bold text-text-primary">{articles.length}</div>
          <div className="text-sm text-text-secondary">Total Articles</div>
        </Card>
        <Card className="admin-card p-4">
          <div className="text-2xl font-bold text-state-success">
            {articles.filter(a => a.isVectorized).length}
          </div>
          <div className="text-sm text-text-secondary">AI Indexed</div>
        </Card>
        <Card className="admin-card p-4">
          <div className="text-2xl font-bold text-primary-600">
            {Math.round(articles.reduce((acc, a) => acc + a.size, 0) / 1024)}
          </div>
          <div className="text-sm text-text-secondary">KB Total Size</div>
        </Card>
        <Card className="admin-card p-4">
          <div className="text-2xl font-bold text-state-info">
            {articles.filter(a => {
              const modified = new Date(a.lastModified);
              const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
              return modified > weekAgo;
            }).length}
          </div>
          <div className="text-sm text-text-secondary">Updated This Week</div>
        </Card>
      </div>


      {/* Articles Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredArticles.map((article) => (
          <Card key={article.filename} className="admin-card p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="w-10 h-10 bg-primary-500/20 rounded-lg flex items-center justify-center">
                <FileText className="w-5 h-5 text-primary-600" />
              </div>
              <div className="flex items-center space-x-2">
                {article.isVectorized ? (
                  <Badge variant="default" className="bg-state-success-bg text-state-success">
                    <Bot className="w-3 h-3 mr-1" />
                    AI Ready
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="bg-state-warning-bg text-state-warning">
                    Pending
                  </Badge>
                )}
              </div>
            </div>

            <h3 className="text-lg font-semibold text-text-primary mb-2">{article.title}</h3>
            <p className="text-sm text-text-secondary mb-4">{article.filename}</p>

            <div className="flex items-center text-xs text-text-muted mb-4">
              <Calendar className="w-3 h-3 mr-1" />
              {new Date(article.lastModified).toLocaleDateString()}
              <span className="mx-2">•</span>
              {Math.round(article.size / 1024)} KB
            </div>

            <div className="flex items-center space-x-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openEditor(article)}
                className="text-primary-600 hover:text-primary-700"
              >
                <Edit className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-state-info hover:opacity-75"
              >
                <Eye className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(article.filename)}
                className="text-state-error hover:opacity-75"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {filteredArticles.length === 0 && !loading && (
        <div className="text-center py-8 text-text-secondary">
          {searchQuery ? "No articles found matching your search." : "No articles available."}
        </div>
      )}

      {/* Article Editor Modal */}
      <ArticleEditor
        article={selectedArticle}
        isOpen={showEditor}
        onClose={closeEditor}
        onSave={handleSaveArticle}
        isNew={isNewArticle}
      />
    </div>
  );
}
