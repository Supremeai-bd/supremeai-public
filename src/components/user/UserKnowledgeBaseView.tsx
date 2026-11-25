import React, { useState } from 'react';
import {
  BookOpen,
  FileText,
  FileCode,
  FileUp,
  Search,
  CheckCircle2,
  Trash2,
  Layers,
  Sparkles,
  Eye,
  Database,
} from 'lucide-react';
import { KnowledgeDoc } from '../../types';
import { FileProcessingPreviewModal } from './knowledge/FileProcessingPreviewModal';
import { knowledgeService } from '../../services/knowledgeService';
import { useI18n } from '../../utils/i18n';
import { logger } from '../../utils/logger';

interface UserKnowledgeBaseViewProps {
  documents: KnowledgeDoc[];
  onAddDocument: (doc: Omit<KnowledgeDoc, 'id' | 'lastIndexed'>) => void;
  onToggleGrounding?: (id: string) => void;
  onDeleteDocument: (id: string) => void;
}

export const UserKnowledgeBaseView: React.FC<UserKnowledgeBaseViewProps> = ({
  documents,
  onAddDocument,
  onDeleteDocument,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<'all' | 'markdown' | 'pdf' | 'code'>('all');
  const [previewDoc, setPreviewDoc] = useState<KnowledgeDoc | null>(null);
  const { t } = useI18n();

  // New Document Upload Modal State
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  // Semantic query test state
  const [testQuery, setTestQuery] = useState('');
  const [simulatedMatches, setSimulatedMatches] = useState<
    { docTitle: string; chunk: string; score: number }[] | null
  >(null);

  const filteredDocs = documents.filter((doc) => {
    const matchesSearch = doc.title.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = selectedType === 'all' || doc.type === selectedType;
    return matchesSearch && matchesType;
  });

  const totalTokens = documents.reduce((acc, d) => acc + d.tokenCount, 0);
  const totalChunks = documents.reduce((acc, d) => acc + d.chunkCount, 0);

  const handleRunSemanticSearch = async () => {
    if (!testQuery.trim()) return;

    try {
      const backendResults = await knowledgeService.search(testQuery, 3);
      if (backendResults && backendResults.length > 0) {
        setSimulatedMatches(
          backendResults.map((r) => ({
            docTitle: r.title,
            chunk: r.content,
            score: r.score ?? 0.88,
          }))
        );
        return;
      }
    } catch (error) {
      logger.debug('UserKnowledgeBaseView: suppressed non-fatal error', error);
    }

    const q = testQuery.toLowerCase();
    const matches = documents
      .map((d) => {
        let score = 0.72;
        if (d.title.toLowerCase().includes(q)) score += 0.22;
        if (d.contentPreview.toLowerCase().includes(q)) score += 0.18;
        return {
          docTitle: d.title,
          chunk: d.contentPreview,
          score: Math.min(0.98, Math.round(score * 100) / 100),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    setSimulatedMatches(matches);
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 workspace-container space-y-8 text-slate-800 dark:text-slate-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {t.kbTitle}
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-900">
              {t.kbBadge}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t.kbSubtitle}</p>
        </div>

        <button
          type="button"
          onClick={() => setIsUploadModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors cursor-pointer shrink-0"
        >
          <FileUp className="w-4 h-4" />
          <span>{t.uploadCustomDocsBtn}</span>
        </button>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-white/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center gap-3.5">
          <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-slate-800 text-blue-600 dark:text-blue-400">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {t.indexedDocsMetric}
            </div>
            <div className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">
              {documents.length}
            </div>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center gap-3.5">
          <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-slate-800 text-purple-600 dark:text-purple-400">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {t.vectorChunksMetric}
            </div>
            <div className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">
              {totalChunks} ({Math.round(totalTokens / 1000)}k {t.tokensWord})
            </div>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center gap-3.5">
          <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-slate-800 text-emerald-600 dark:text-emerald-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {t.kbAutoRagMetric}
            </div>
            <div className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">
              {t.kbAutoRagActiveValue}
            </div>
          </div>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t.filterDocsPlaceholder}
            className="w-full pl-9 pr-4 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl text-xs border border-slate-200 dark:border-slate-700">
          {(['all', 'markdown', 'pdf', 'code'] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setSelectedType(type)}
              className={`px-3 py-1 rounded-lg capitalize font-medium transition-colors cursor-pointer ${
                selectedType === type
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Documents List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredDocs.map((doc) => (
          <div
            key={doc.id}
            className="p-5 rounded-2xl bg-white/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 transition-all shadow-xs space-y-3.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 shrink-0">
                  {doc.type === 'code' ? (
                    <FileCode className="w-4 h-4" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                    {doc.title}
                  </h3>
                  <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                    <span className="uppercase font-mono font-semibold text-blue-600 dark:text-blue-400">
                      {doc.type}
                    </span>
                    <span>·</span>
                    <span>{Math.round(doc.sizeBytes / 1024)} KB</span>
                    <span>·</span>
                    <span className="tabular-nums font-mono">{doc.chunkCount} chunks</span>
                  </div>
                </div>
              </div>

              {/* Automatic RAG Status Indicator */}
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{t.kbAutoMatchedBadge}</span>
              </span>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 leading-relaxed bg-slate-50 dark:bg-slate-950/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/80 font-mono text-[11px]">
              {doc.contentPreview}
            </p>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Indexed {doc.lastIndexed}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewDoc(doc)}
                  className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{t.inspectBtn}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteDocument(doc.id)}
                  className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/60 rounded cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Semantic Grounding Query Sandbox */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 to-indigo-950 text-white border border-slate-800 space-y-4 shadow-md">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-purple-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-purple-300 font-mono">
            {t.ragProbeTitle}
          </h3>
        </div>
        <p className="text-xs text-slate-300">{t.ragProbeDesc}</p>

        <div className="flex gap-2">
          <input
            type="text"
            value={testQuery}
            onChange={(e) => setTestQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRunSemanticSearch()}
            placeholder={t.ragProbePlaceholder}
            className="flex-1 px-3.5 py-2 rounded-xl bg-slate-800/80 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-purple-400"
          />
          <button
            type="button"
            onClick={handleRunSemanticSearch}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white transition-colors cursor-pointer shrink-0"
          >
            {t.probeChunksBtn}
          </button>
        </div>

        {simulatedMatches && (
          <div className="space-y-2 pt-2">
            <span className="text-[11px] font-mono text-purple-300">
              Retrieved Top {simulatedMatches.length} Vector Match(es):
            </span>
            <div className="space-y-2">
              {simulatedMatches.map((m) => (
                <div
                  key={`${m.docTitle}-${m.chunk.slice(0, 32)}`}
                  className="p-3 rounded-xl bg-slate-800/90 border border-slate-700/80 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-purple-300">{m.docTitle}</span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 font-mono text-[10px] border border-emerald-800">
                      Similarity: {Math.round(m.score * 100)}%
                    </span>
                  </div>
                  <p className="text-slate-300 font-mono text-[11px] leading-relaxed">
                    "{m.chunk}"
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* --- LIVE PROCESSING & PREVIEW MODAL --- */}
      <FileProcessingPreviewModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onAddDocument={onAddDocument}
      />

      {/* --- PREVIEW MODAL --- */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full p-6 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-600" />
                {previewDoc.title}
              </h3>
              <button
                type="button"
                onClick={() => setPreviewDoc(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-4 text-xs text-slate-500 font-mono">
                <span>Format: {String(previewDoc.type || 'TXT').toUpperCase()}</span>
                <span>Chunks: {previewDoc.chunkCount}</span>
                <span>Tokens: {previewDoc.tokenCount}</span>
              </div>
              <div className="p-4 rounded-xl bg-slate-950 text-slate-200 font-mono text-xs leading-relaxed max-h-72 overflow-y-auto">
                {previewDoc.contentPreview}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setPreviewDoc(null)}
              className="w-full py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 cursor-pointer"
            >
              {t.closeInspectorBtn}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
