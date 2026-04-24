/**
 * InformationRequestPage — Lex Law Next v1
 *
 * Ch 31 — Information Request (Matrix) UI
 *
 * Displays and manages information request matrices for a matter.
 * Supports generating, editing questions, attaching answers, and exporting.
 *
 * Procedures used:
 *   - informationRequest.list (query)
 *   - informationRequest.get (query)
 *   - informationRequest.generate (mutation)
 *   - informationRequest.archive (mutation)
 *   - informationRequest.editQuestion (mutation)
 *   - informationRequest.addQuestion (mutation)
 *   - informationRequest.deleteQuestion (mutation)
 *   - informationRequest.attachAnswer (mutation)
 *   - informationRequest.markComplete (mutation)
 *   - informationRequest.exportText (mutation) — plain text only (Phase 5)
 *   - job.listForMatter (query) — to show generation job status
 *
 * Phase 5 scope: exportText is plain text only. No .docx pipeline.
 *
 * Ch 35.3 — No business logic in React.
 * Ch 35.13 — Every mutation uses useGuardedMutation.
 */
import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Plus, Archive, CheckCircle, RefreshCw, Download,
  Edit2, Trash2, ChevronDown, ChevronUp, MessageSquare
} from 'lucide-react';
import clsx from 'clsx';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';

// ============================================================
// ItemRow — single question/answer row
// ============================================================
interface ItemRowProps {
  item: {
    id: string;
    category: string;
    questionText: string;
    answerText: string | null;
    orderIndex: number;
  };
  matrixId: string;
  isArchived: boolean;
  onRefresh: () => void;
}

function ItemRow({ item, matrixId, isArchived, onRefresh }: ItemRowProps): React.ReactElement {
  const [editingQuestion, setEditingQuestion] = useState(false);
  const [questionInput, setQuestionInput] = useState(item.questionText);
  const [editingAnswer, setEditingAnswer] = useState(false);
  const [answerInput, setAnswerInput] = useState(item.answerText ?? '');
  const utils = trpc.useUtils();

  const editMutation = useGuardedMutation(
    (input: { itemId: string; questionText?: string; category?: string }) =>
      utils.client.informationRequest.editQuestion.mutate(input),
    {
      onSuccess: () => {
        void utils.informationRequest.get.invalidate({ matrixId });
        setEditingQuestion(false);
        onRefresh();
      },
    }
  );

  const deleteMutation = useGuardedMutation(
    (input: { itemId: string }) => utils.client.informationRequest.deleteQuestion.mutate(input),
    {
      onSuccess: () => {
        void utils.informationRequest.get.invalidate({ matrixId });
        onRefresh();
      },
    }
  );

  const attachAnswerMutation = useGuardedMutation(
    (input: { itemId: string; answerText: string }) =>
      utils.client.informationRequest.attachAnswer.mutate(input),
    {
      onSuccess: () => {
        void utils.informationRequest.get.invalidate({ matrixId });
        setEditingAnswer(false);
        onRefresh();
      },
    }
  );

  return (
    <div className={clsx(
      'border border-gray-100 rounded-lg p-3 space-y-2',
      item.answerText && 'bg-green-50/50'
    )}>
      {/* Question */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {editingQuestion ? (
            <div className="space-y-1">
              <textarea
                value={questionInput}
                onChange={(e) => setQuestionInput(e.target.value)}
                rows={2}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-firm-navy resize-none"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setEditingQuestion(false); setQuestionInput(item.questionText); }}
                  className="px-2 py-1 text-xs text-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={() => editMutation.mutate({ itemId: item.id, questionText: questionInput.trim() })}
                  disabled={editMutation.isPending}
                  className="px-2 py-1 text-xs bg-firm-navy text-white rounded disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-800">{item.questionText}</p>
          )}
        </div>
        {!isArchived && !editingQuestion && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setEditingQuestion(true)}
              className="p-1 text-gray-400 hover:text-firm-navy"
              title="Edit question"
            >
              <Edit2 className="w-3 h-3" />
            </button>
            <button
              onClick={() => deleteMutation.mutate({ itemId: item.id })}
              disabled={deleteMutation.isPending}
              className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-50"
              title="Delete question"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Answer */}
      <div className="ml-0">
        {editingAnswer ? (
          <div className="space-y-1">
            <textarea
              value={answerInput}
              onChange={(e) => setAnswerInput(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-firm-navy resize-y"
              placeholder="Enter answer…"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setEditingAnswer(false); setAnswerInput(item.answerText ?? ''); }}
                className="px-2 py-1 text-xs text-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={() => attachAnswerMutation.mutate({ itemId: item.id, answerText: answerInput })}
                disabled={attachAnswerMutation.isPending}
                className="px-2 py-1 text-xs bg-firm-navy text-white rounded disabled:opacity-50"
              >
                Save Answer
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <MessageSquare className="w-3 h-3 text-gray-300 flex-shrink-0 mt-0.5" />
            {item.answerText ? (
              <p className="text-xs text-gray-600 flex-1">{item.answerText}</p>
            ) : (
              <p className="text-xs text-gray-400 italic flex-1">No answer yet.</p>
            )}
            {!isArchived && (
              <button
                onClick={() => setEditingAnswer(true)}
                className="text-xs text-firm-navy hover:underline flex-shrink-0"
              >
                {item.answerText ? 'Edit' : 'Add Answer'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// MatrixDetail — expanded view of a single matrix
// ============================================================
interface MatrixDetailProps {
  matrixId: string;
  isArchived: boolean;
}

function MatrixDetail({ matrixId, isArchived }: MatrixDetailProps): React.ReactElement {
  const utils = trpc.useUtils();
  const [addingQuestion, setAddingQuestion] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [newQuestion, setNewQuestion] = useState('');
  const [exportedText, setExportedText] = useState<string | null>(null);

  const { data, refetch } = trpc.informationRequest.get.useQuery({ matrixId });

  const addMutation = useGuardedMutation(
    (input: { matrixId: string; category: string; questionText: string; orderIndex: number }) =>
      utils.client.informationRequest.addQuestion.mutate(input),
    {
      onSuccess: () => {
        void utils.informationRequest.get.invalidate({ matrixId });
        setAddingQuestion(false);
        setNewCategory('');
        setNewQuestion('');
      },
    }
  );

  const markCompleteMutation = useGuardedMutation(
    (input: { matrixId: string }) => utils.client.informationRequest.markComplete.mutate(input),
    { onSuccess: () => void utils.informationRequest.get.invalidate({ matrixId }) }
  );

  const exportTextMutation = useGuardedMutation(
    (input: { matrixId: string; format: 'text' }) => utils.client.informationRequest.exportText.mutate(input),
    {
      onSuccess: (result) => {
        setExportedText(result.text);
      },
    }
  );

  if (!data) return <div className="p-3 text-xs text-gray-400">Loading…</div>;

  const { matrix, items } = data;

  // Group items by category
  const byCategory = new Map<string, typeof items>();
  for (const item of items) {
    const existing = byCategory.get(item.category) ?? [];
    existing.push(item);
    byCategory.set(item.category, existing);
  }

  const answeredCount = items.filter((i) => i.answerText).length;
  const completedCount = items.filter((i) => i.answerText).length;

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span>{items.length} questions</span>
        <span>{answeredCount} answered</span>
        <span>{completedCount} completed</span>
      </div>

      {/* Actions */}
      {!isArchived && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAddingQuestion(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 text-gray-700 rounded hover:bg-gray-50"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Question
          </button>
          {matrix.status !== 'complete' && (
            <button
              onClick={() => markCompleteMutation.mutate({ matrixId })}
              disabled={markCompleteMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Mark Complete
            </button>
          )}
          <button
            onClick={() => exportTextMutation.mutate({ matrixId, format: 'text' })}
            disabled={exportTextMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50 ml-auto"
          >
            <Download className="w-3.5 h-3.5" />
            Export Text
          </button>
        </div>
      )}

      {/* Add question form */}
      {addingQuestion && (
        <div className="p-3 bg-gray-50 rounded-lg space-y-2 border border-gray-200">
          <input
            type="text"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="Category (e.g., Financial, Legal)"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-firm-navy"
          />
          <textarea
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            rows={2}
            placeholder="Question text…"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-firm-navy resize-none"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setAddingQuestion(false)} className="px-3 py-1.5 text-xs text-gray-600">
              Cancel
            </button>
            <button
              onClick={() => {
                if (!newCategory.trim() || !newQuestion.trim()) return;
                addMutation.mutate({
                  matrixId,
                  category: newCategory.trim(),
                  questionText: newQuestion.trim(),
                  orderIndex: items.length,
                });
              }}
              disabled={addMutation.isPending || !newCategory.trim() || !newQuestion.trim()}
              className="px-3 py-1.5 text-xs bg-firm-navy text-white rounded disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Exported text */}
      {exportedText && (
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-600">Exported Text</span>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(exportedText);
              }}
              className="text-xs text-firm-navy hover:underline"
            >
              Copy
            </button>
          </div>
          <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
            {exportedText}
          </pre>
        </div>
      )}

      {/* Questions by category */}
      {byCategory.size === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">No questions yet.</p>
      ) : (
        Array.from(byCategory.entries()).map(([category, categoryItems]) => (
          <div key={category}>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{category}</h4>
            <div className="space-y-2">
              {categoryItems.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  matrixId={matrixId}
                  isArchived={isArchived}
                  onRefresh={() => void refetch()}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ============================================================
// MatrixCard — collapsed/expanded matrix card
// ============================================================
interface MatrixCardProps {
  matrix: {
    id: string;
    matterId: string;
    status: string;
    archivedAt: string | null;
    createdAt: string;
  };
  matterId: string;
}

function MatrixCard({ matrix, matterId }: MatrixCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const utils = trpc.useUtils();

  const archiveMutation = useGuardedMutation(
    (input: { matrixId: string }) => utils.client.informationRequest.archive.mutate(input),
    { onSuccess: () => void utils.informationRequest.list.invalidate({ matterId }) }
  );

  const isArchived = matrix.archivedAt !== null;

  return (
    <div className={clsx('border border-gray-200 rounded-lg overflow-hidden', isArchived && 'opacity-60')}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-firm-navy">
              Information Request
            </span>
            <span className={clsx(
              'text-xs px-1.5 py-0.5 rounded',
              matrix.status === 'draft' && 'bg-amber-100 text-amber-700',
              matrix.status === 'complete' && 'bg-green-100 text-green-700',
              matrix.status === 'generating' && 'bg-blue-100 text-blue-700',
            )}>
              {matrix.status}
            </span>
            {isArchived && (
              <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">Archived</span>
            )}
          </div>
          <span className="text-xs text-gray-400">{new Date(matrix.createdAt).toLocaleDateString()}</span>
        </div>
        <div className="flex items-center gap-1">
          {!isArchived && (
            <button
              onClick={() => archiveMutation.mutate({ matrixId: matrix.id })}
              disabled={archiveMutation.isPending}
              title="Archive"
              className="p-1.5 text-gray-400 hover:text-firm-navy disabled:opacity-50"
            >
              <Archive className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 text-gray-400 hover:text-firm-navy"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 p-4">
          <MatrixDetail matrixId={matrix.id} isArchived={isArchived} />
        </div>
      )}
    </div>
  );
}

// ============================================================
// InformationRequestPage — main export
// ============================================================
export default function InformationRequestPage(): React.ReactElement {
  const { matterId } = useParams<{ matterId: string }>();
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.informationRequest.list.useQuery(
    { matterId: matterId! },
    { enabled: !!matterId }
  );

  const { data: jobsData } = trpc.job.listForMatter.useQuery(
    { matterId: matterId! },
    {
      enabled: !!matterId,
      refetchInterval: (query) => {
        const jobs = query.state.data?.jobs ?? [];
        const hasActive = jobs.some(
          (j) => (j.status === 'queued' || j.status === 'running') && j.jobType === 'information_request_generation'
        );
        return hasActive ? 5000 + Math.random() * 1000 : false;
      },
    }
  );

  const generateMutation = useGuardedMutation(
    (input: { matterId: string }) => utils.client.informationRequest.generate.mutate(input),
    {
      onSuccess: () => {
        void utils.informationRequest.list.invalidate({ matterId: matterId! });
        void utils.job.listForMatter.invalidate({ matterId: matterId! });
      },
    }
  );

  const matrices = data?.matrices ?? [];
  const activeGenerationJob = (jobsData?.jobs ?? []).find(
    (j) => (j.status === 'queued' || j.status === 'running') && j.jobType === 'information_request_generation'
  );
  const hasActiveMatrix = matrices.some((m) => !m.archivedAt);

  if (!matterId) return <div className="p-6 text-red-600">Invalid matter ID.</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4 text-sm text-gray-500">
        <Link to="/matters" className="hover:text-firm-navy">Matters</Link>
        <span>/</span>
        <Link to={`/matters/${matterId}`} className="hover:text-firm-navy flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" />
          Matter
        </Link>
        <span>/</span>
        <span className="text-firm-navy font-medium">Information Requests</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-garamond font-semibold text-firm-navy">Information Requests</h1>
        {!hasActiveMatrix && !activeGenerationJob && (
          <button
            onClick={() => generateMutation.mutate({ matterId })}
            disabled={generateMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-firm-navy text-white text-sm rounded hover:bg-opacity-90 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {generateMutation.isPending ? 'Generating…' : 'Generate Information Request'}
          </button>
        )}
      </div>

      {/* Active generation job banner */}
      {activeGenerationJob && (
        <div className="mb-4 flex items-center gap-3 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm">
          <RefreshCw className="w-4 h-4 text-amber-600 animate-spin flex-shrink-0" />
          <span className="text-amber-800">Generating information request…</span>
        </div>
      )}

      {/* Matrix list */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
      ) : matrices.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-400 text-sm">No information requests yet.</p>
          <p className="text-gray-400 text-xs mt-1">Generate one to create a structured question matrix.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {matrices.map((m) => (
            <MatrixCard key={m.id} matrix={m} matterId={matterId} />
          ))}
        </div>
      )}
    </div>
  );
}
