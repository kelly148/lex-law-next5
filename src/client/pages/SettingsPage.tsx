/**
 * SettingsPage — Lex Law Next v1
 *
 * Ch 29a — Settings UI
 *
 * Displays and allows editing of:
 *   1. Reviewer enablement toggles (claude, gpt, gemini, grok)
 *   2. Voice input preferences (forceShowAll, forceHideAll, dictationLanguage)
 *
 * Constraints (per Phase 5 scope):
 *   - NO model selection UI anywhere on this page
 *   - settings.updateVoiceInput: only forceShowAll, forceHideAll, dictationLanguage
 *   - WOULD_DISABLE_ALL_REVIEWERS guard handled by server; UI shows error message
 *
 * Procedures used:
 *   - settings.get (query)
 *   - settings.updateReviewerEnablement (mutation)
 *   - settings.updateVoiceInput (mutation)
 *
 * Ch 35.3 — No business logic in React.
 * Ch 35.13 — Every mutation uses useGuardedMutation.
 *
 * State-sync pattern: section components receive `initial` props and are
 * remounted via `key` when server data changes, avoiding useEffect+setState.
 */
import React, { useState } from 'react';
import { Settings, Mic, Users } from 'lucide-react';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';

const DICTATION_LANGUAGES = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es-ES', label: 'Spanish (Spain)' },
  { value: 'es-MX', label: 'Spanish (Mexico)' },
  { value: 'fr-FR', label: 'French' },
  { value: 'de-DE', label: 'German' },
  { value: 'it-IT', label: 'Italian' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'ja-JP', label: 'Japanese' },
  { value: 'zh-CN', label: 'Chinese (Simplified)' },
];

const REVIEWER_LABELS: Record<string, string> = {
  claude: 'Claude (Anthropic)',
  gpt: 'GPT (OpenAI)',
  gemini: 'Gemini (Google)',
  grok: 'Grok (xAI)',
};

// ============================================================
// ReviewerEnablementSection
// ============================================================
interface ReviewerEnablementSectionProps {
  initial: { claude: boolean; gpt: boolean; gemini: boolean; grok: boolean };
}

function ReviewerEnablementSection({ initial }: ReviewerEnablementSectionProps): React.ReactElement {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const utils = trpc.useUtils();

  const updateMutation = useGuardedMutation(
    (input: { reviewerEnablement: { claude: boolean; gpt: boolean; gemini: boolean; grok: boolean } }) =>
      utils.client.settings.updateReviewerEnablement.mutate(input),
    {
      onSuccess: () => {
        void utils.settings.get.invalidate();
        setError(null);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      },
      onError: (err) => {
        if (err.message.includes('WOULD_DISABLE_ALL_REVIEWERS')) {
          setError('At least one reviewer must remain enabled.');
        } else {
          setError(err.message);
        }
      },
    }
  );

  const toggle = (key: keyof typeof values): void => {
    const next = { ...values, [key]: !values[key] };
    setValues(next);
    updateMutation.mutate({ reviewerEnablement: next });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-center gap-2 mb-4">
        <Users className="w-5 h-5 text-firm-navy" />
        <h2 className="text-base font-semibold text-firm-navy">Reviewer Enablement</h2>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Enable or disable AI reviewers. At least one reviewer must remain enabled.
      </p>
      <div className="space-y-3">
        {(Object.keys(REVIEWER_LABELS) as Array<keyof typeof values>).map((key) => (
          <div key={key} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
            <div>
              <span className="text-sm font-medium text-gray-800">{REVIEWER_LABELS[key]}</span>
            </div>
            <button
              onClick={() => toggle(key)}
              disabled={updateMutation.isPending}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                values[key] ? 'bg-firm-navy' : 'bg-gray-300'
              }`}
              role="switch"
              aria-checked={values[key]}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  values[key] ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        ))}
      </div>
      {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
      {saved && <p className="text-green-600 text-sm mt-3">Saved.</p>}
    </div>
  );
}

// ============================================================
// VoiceInputSection
// ============================================================
interface VoiceInputSectionProps {
  initial: { forceShowAll: boolean; forceHideAll: boolean; dictationLanguage: string };
}

function VoiceInputSection({ initial }: VoiceInputSectionProps): React.ReactElement {
  const [forceShowAll, setForceShowAll] = useState(initial.forceShowAll);
  const [forceHideAll, setForceHideAll] = useState(initial.forceHideAll);
  const [dictationLanguage, setDictationLanguage] = useState(initial.dictationLanguage);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const updateMutation = useGuardedMutation(
    (input: { voiceInput: { forceShowAll: boolean; forceHideAll: boolean; dictationLanguage: string } }) =>
      utils.client.settings.updateVoiceInput.mutate(input),
    {
      onSuccess: () => {
        void utils.settings.get.invalidate();
        setError(null);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      },
      onError: (err) => setError(err.message),
    }
  );

  const handleSave = (): void => {
    updateMutation.mutate({ voiceInput: { forceShowAll, forceHideAll, dictationLanguage } });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-center gap-2 mb-4">
        <Mic className="w-5 h-5 text-firm-navy" />
        <h2 className="text-base font-semibold text-firm-navy">Voice Input</h2>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Configure voice input behavior for dictation fields.
      </p>
      <div className="space-y-4">
        {/* Force show all */}
        <div className="flex items-center justify-between py-2 border-b border-gray-100">
          <div>
            <span className="text-sm font-medium text-gray-800">Force Show All</span>
            <p className="text-xs text-gray-500 mt-0.5">Show voice input controls on all text fields</p>
          </div>
          <button
            onClick={() => setForceShowAll(!forceShowAll)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              forceShowAll ? 'bg-firm-navy' : 'bg-gray-300'
            }`}
            role="switch"
            aria-checked={forceShowAll}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                forceShowAll ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Force hide all */}
        <div className="flex items-center justify-between py-2 border-b border-gray-100">
          <div>
            <span className="text-sm font-medium text-gray-800">Force Hide All</span>
            <p className="text-xs text-gray-500 mt-0.5">Hide voice input controls on all text fields</p>
          </div>
          <button
            onClick={() => setForceHideAll(!forceHideAll)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              forceHideAll ? 'bg-firm-navy' : 'bg-gray-300'
            }`}
            role="switch"
            aria-checked={forceHideAll}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                forceHideAll ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Dictation language */}
        <div className="py-2">
          <label className="block text-sm font-medium text-gray-800 mb-1">Dictation Language</label>
          <select
            value={dictationLanguage}
            onChange={(e) => setDictationLanguage(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
          >
            {DICTATION_LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value}>{lang.label}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
      {saved && <p className="text-green-600 text-sm mt-3">Saved.</p>}

      <div className="mt-4 flex justify-end">
        <button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          className="px-4 py-2 text-sm bg-firm-navy text-white rounded hover:bg-opacity-90 disabled:opacity-50"
        >
          {updateMutation.isPending ? 'Saving…' : 'Save Voice Settings'}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// SettingsPage — main export
// ============================================================
export default function SettingsPage(): React.ReactElement {
  const { data, isLoading } = trpc.settings.get.useQuery();

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Settings className="w-6 h-6 text-firm-navy" />
        <h1 className="text-2xl font-garamond font-semibold text-firm-navy">Settings</h1>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading settings…</div>
      ) : !data ? (
        <div className="text-center py-12 text-red-600 text-sm">Failed to load settings.</div>
      ) : (
        <div className="space-y-6">
          {/*
           * key props remount sections when server data changes, avoiding
           * the useEffect+setState anti-pattern (react-hooks/set-state-in-effect).
           */}
          <ReviewerEnablementSection
            key={`${data.reviewerEnablement.claude}-${data.reviewerEnablement.gpt}-${data.reviewerEnablement.gemini}-${data.reviewerEnablement.grok}`}
            initial={data.reviewerEnablement}
          />
          <VoiceInputSection
            key={`${data.voiceInput.forceShowAll}-${data.voiceInput.forceHideAll}-${data.voiceInput.dictationLanguage}`}
            initial={data.voiceInput}
          />
        </div>
      )}
    </div>
  );
}
