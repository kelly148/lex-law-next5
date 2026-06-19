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
import React, { useState, useRef } from 'react';
import { Settings, Mic, Users, Lock, Bell, ShieldAlert } from 'lucide-react';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import type { NotificationPreferences } from '../../shared/schemas/matters.js';

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
  // prevRef captures the pre-toggle state so onError can roll back the optimistic update.
  const prevRef = useRef(initial);

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
        // Roll back the optimistic toggle to the pre-mutation state.
        setValues(prevRef.current);
        if (err.message.includes('WOULD_DISABLE_ALL_REVIEWERS')) {
          setError('At least one reviewer must remain enabled.');
        } else {
          setError(err.message);
        }
      },
    }
  );

  const toggle = (key: keyof typeof values): void => {
    prevRef.current = values;
    const next = { ...values, [key]: !values[key] };
    // Optimistic update — rolled back in onError if the server rejects.
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
          className="px-4 py-2 text-sm bg-accent text-on-accent rounded hover:bg-accent-hover disabled:opacity-50"
        >
          {updateMutation.isPending ? 'Saving…' : 'Save Voice Settings'}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// NotificationPreferencesSection (NOTIFY-SUITE-1 N3)
// ============================================================
// Mirrors ReviewerEnablementSection: optimistic toggles over the notificationPreferences blob through
// settings.updateNotificationPreferences. Default-safe; informational only. The per-event toggles map to
// the producer surfaces — only 'deadline' (N2) is live today; the rest are forward-looking. Per-matter mute
// is set from the matter, not this global panel.
const NOTIFY_EVENT_LABELS: Record<keyof NotificationPreferences['events'], string> = {
  reviewComplete: 'Review complete',
  reviewFailed: 'Review failed',
  regeneration: 'Regenerations',
  extraction: 'Extractions',
  sendability: 'Sendability checks',
  deadline: 'Deadline reminders',
};

function ToggleRow({
  label,
  hint,
  checked,
  onToggle,
  disabled,
  testid,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  testid: string;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <div>
        <span className="text-sm font-medium text-gray-800">{label}</span>
        {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
      </div>
      <button
        type="button"
        data-testid={testid}
        onClick={onToggle}
        disabled={disabled}
        role="switch"
        aria-checked={checked}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
          checked ? 'bg-firm-navy' : 'bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

function NotificationPreferencesSection({ initial }: { initial: NotificationPreferences }): React.ReactElement {
  const [prefs, setPrefs] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const utils = trpc.useUtils();
  const prevRef = useRef(initial);

  const updateMutation = useGuardedMutation(
    (input: { notificationPreferences: NotificationPreferences }) =>
      utils.client.settings.updateNotificationPreferences.mutate(input),
    {
      onSuccess: () => {
        void utils.settings.get.invalidate();
        setError(null);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      },
      onError: (err) => {
        setPrefs(prevRef.current); // roll back the optimistic toggle
        setError(err.message);
      },
    }
  );

  const save = (next: NotificationPreferences): void => {
    prevRef.current = prefs;
    setPrefs(next); // optimistic
    updateMutation.mutate({ notificationPreferences: next });
  };
  const toggleTop = (key: 'inApp' | 'digest' | 'sound'): void => save({ ...prefs, [key]: !prefs[key] });
  const toggleEvent = (key: keyof NotificationPreferences['events']): void =>
    save({ ...prefs, events: { ...prefs.events, [key]: !prefs.events[key] } });

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6" data-testid="notification-preferences">
      <div className="flex items-center gap-2 mb-4">
        <Bell className="w-5 h-5 text-firm-navy" />
        <h2 className="text-base font-semibold text-firm-navy">Notifications</h2>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        In-app alerts for what happens while you work. Informational only — they never act on their own.
      </p>
      <div className="space-y-1">
        <ToggleRow
          label="In-app notifications"
          hint="The bell + per-matter badges. Turning this off silences all in-app alerts."
          checked={prefs.inApp}
          onToggle={() => toggleTop('inApp')}
          disabled={updateMutation.isPending}
          testid="notif-toggle-inApp"
        />
        <ToggleRow
          label="“While you were away” digest"
          hint="A single summary on return instead of many separate alerts."
          checked={prefs.digest}
          onToggle={() => toggleTop('digest')}
          disabled={updateMutation.isPending || !prefs.inApp}
          testid="notif-toggle-digest"
        />
        <ToggleRow
          label="Sound"
          checked={prefs.sound}
          onToggle={() => toggleTop('sound')}
          disabled={updateMutation.isPending || !prefs.inApp}
          testid="notif-toggle-sound"
        />
      </div>

      <p className="text-xs font-medium text-gray-500 mt-5 mb-1 uppercase tracking-wide">Alert me about</p>
      <div className="space-y-1">
        {(Object.keys(NOTIFY_EVENT_LABELS) as Array<keyof NotificationPreferences['events']>).map((key) => (
          <ToggleRow
            key={key}
            label={NOTIFY_EVENT_LABELS[key]}
            checked={prefs.events[key]}
            onToggle={() => toggleEvent(key)}
            disabled={updateMutation.isPending || !prefs.inApp}
            testid={`notif-event-${key}`}
          />
        ))}
      </div>

      {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
      {saved && <p className="text-green-600 text-sm mt-3">Saved.</p>}
    </div>
  );
}

// ============================================================
// ConflictEnforcementSection (CONFLICT-TOGGLE-1 Inc 3 — anti-silent-off UX)
// ============================================================
// The firm-scoped "Conflict clearance enforcement" admin surface. DELIBERATELY labeled enforcement (NOT
// "conflicts checking") to kill the "off = no conflicts" misread (disposition item 8). Representational
// matters are ALWAYS fully enforced and non-disableable; only the transactional (title/settlement scrivener)
// default may be relaxed to ADVISORY — and only through a typed confirmation + a required reason (item 8).
// Self-gates on conflictPolicy.isEnabled so the whole surface is DARK on prod until the gate is activated.
function ConflictEnforcementSection(): React.ReactElement | null {
  const enabledQ = trpc.conflictPolicy.isEnabled.useQuery();
  // Dark until the conflict gate is enabled (prod default). The hook is called unconditionally above.
  if (!enabledQ.data?.enabled) return null;
  return <ConflictEnforcementPanel />;
}

function ConflictEnforcementPanel(): React.ReactElement {
  const { data, isLoading } = trpc.conflictPolicy.get.useQuery();
  const historyQ = trpc.conflictPolicy.history.useQuery({ limit: 1 });
  const utils = trpc.useUtils();
  const [pendingRelax, setPendingRelax] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const setPolicyMutation = useGuardedMutation(
    (input: { policy: { schemaVersion: 1; transactionalPosture: 'ENFORCED' | 'ADVISORY' }; reasonText?: string }) =>
      utils.client.conflictPolicy.setPolicy.mutate(input),
    {
      onSuccess: () => {
        void utils.conflictPolicy.get.invalidate();
        void utils.conflictPolicy.history.invalidate();
        setError(null);
        setSaved(true);
        setPendingRelax(false);
        setConfirmText('');
        setReason('');
        setTimeout(() => setSaved(false), 2500);
      },
      onError: (err) => setError(err.message),
    },
  );

  const header = (
    <div className="flex items-center gap-2 mb-4">
      <ShieldAlert className="w-5 h-5 text-firm-navy" />
      <h2 className="text-base font-semibold text-firm-navy">Conflict clearance enforcement</h2>
    </div>
  );
  const wrap = (inner: React.ReactNode): React.ReactElement => (
    <div className="bg-white border border-gray-200 rounded-lg p-6" data-testid="conflict-enforcement">
      {header}
      {inner}
    </div>
  );

  if (isLoading) return wrap(<p className="text-sm text-gray-400">Loading…</p>);
  if (!data) return wrap(<p className="text-sm text-red-600">Failed to load the conflict policy.</p>);

  const current = data.policy.transactionalPosture; // 'ENFORCED' | 'ADVISORY'
  const forceOn = data.forceOn;
  const relaxedSince = current === 'ADVISORY' ? (historyQ.data?.entries[0]?.createdAt ?? null) : null;
  const confirmReady = confirmText.trim() === 'ADVISORY' && reason.trim().length > 0 && !setPolicyMutation.isPending;

  const tighten = (): void => {
    setError(null);
    setPolicyMutation.mutate({ policy: { schemaVersion: 1, transactionalPosture: 'ENFORCED' } });
  };
  const confirmRelax = (): void => {
    if (confirmText.trim() !== 'ADVISORY') {
      setError('Type ADVISORY to confirm.');
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required to relax enforcement.');
      return;
    }
    setPolicyMutation.mutate({ policy: { schemaVersion: 1, transactionalPosture: 'ADVISORY' }, reasonText: reason.trim() });
  };

  return wrap(
    <>
      <p className="text-sm text-gray-500 mb-4">
        This is an ethics control, not a convenience setting. <span className="font-medium">Representational matters
        are always fully enforced</span> and cannot be relaxed here. Only transactional (title/settlement scrivener)
        matters can run in an advisory posture — and even then the conflicts check still runs and a real conflict still
        blocks.
      </p>

      {forceOn && (
        <div
          data-testid="conflict-forceon-lock"
          className="flex items-center gap-2 mb-4 rounded border border-firm-navy/30 bg-firm-navy/5 px-3 py-2 text-sm text-firm-navy"
        >
          <Lock className="w-4 h-4" />
          Locked ON by server policy (CONFLICT_GATE_FORCE_ON): every matter is fully enforced; this control cannot relax it.
        </div>
      )}

      {/* Effective posture per capacity (read-only). */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center justify-between py-1 text-sm">
          <span className="text-gray-800">Representational matters (law firm)</span>
          <span className="font-medium text-firm-navy">ENFORCED · always</span>
        </div>
        <div className="flex items-center justify-between py-1 text-sm">
          <span className="text-gray-800">Transactional matters (title / settlement scrivener)</span>
          <span data-testid="conflict-transactional-effective" className="font-medium text-firm-navy">
            {data.effectiveByCapacity.title_settlement_agent}
          </span>
        </div>
      </div>

      {/* The transactional control — relaxation is gated behind a typed confirmation + reason. */}
      {!forceOn && current === 'ENFORCED' && !pendingRelax && (
        <button
          data-testid="conflict-begin-relax"
          onClick={() => {
            setPendingRelax(true);
            setError(null);
          }}
          disabled={setPolicyMutation.isPending}
          className="px-3 py-2 text-sm border border-gray-300 rounded text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Relax transactional matters to advisory…
        </button>
      )}

      {!forceOn && current === 'ENFORCED' && pendingRelax && (
        <div data-testid="conflict-relax-confirm" className="rounded border border-amber-300 bg-amber-50 p-4 space-y-3">
          <p className="text-sm text-amber-900">
            You are relaxing conflict-clearance enforcement to <span className="font-semibold">ADVISORY</span> for
            transactional matters. The check still runs and a real conflict still blocks, but the absence of affirmative
            clearance will no longer stop drafting/export. Type <span className="font-mono font-semibold">ADVISORY</span>{' '}
            to confirm and give a reason.
          </p>
          <input
            data-testid="conflict-confirm-input"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type ADVISORY"
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
          />
          <textarea
            data-testid="conflict-reason-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required) — e.g. deed/POA scrivener desk only, no represented adverse parties"
            rows={2}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setPendingRelax(false);
                setConfirmText('');
                setReason('');
                setError(null);
              }}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              data-testid="conflict-confirm-relax"
              onClick={confirmRelax}
              disabled={!confirmReady}
              className="px-3 py-2 text-sm bg-amber-700 text-white rounded hover:bg-amber-800 disabled:opacity-50"
            >
              Confirm relaxation
            </button>
          </div>
        </div>
      )}

      {!forceOn && current === 'ADVISORY' && (
        <div className="space-y-2">
          <div
            data-testid="conflict-relaxed-banner"
            className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            Transactional matters are running in <span className="font-semibold">ADVISORY</span> posture
            {relaxedSince ? <> — relaxed since {new Date(relaxedSince).toLocaleDateString()}</> : null}. The check still
            runs and a real conflict still blocks.
          </div>
          <button
            data-testid="conflict-restore-enforced"
            onClick={tighten}
            disabled={setPolicyMutation.isPending}
            className="px-3 py-2 text-sm border border-line text-ink rounded hover:bg-surface disabled:opacity-50"
          >
            Restore full enforcement
          </button>
        </div>
      )}

      {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
      {saved && <p className="text-green-600 text-sm mt-3">Saved.</p>}
    </>,
  );
}

// ============================================================
// ChangePasswordSection (FOLD-AUTH-CHANGEPW)
// ============================================================
// UI half of FOLD-AUTH-1's self-serve password change. Wraps the existing,
// already-shipped auth.changePassword procedure (server-authoritative: bcrypt-
// verifies the current password, requires the new one to differ, min 10 chars).
// Light client-side guards mirror the server only for UX; the server is the gate.
const NEW_PASSWORD_MIN = 10;

function ChangePasswordSection(): React.ReactElement {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const utils = trpc.useUtils();

  const changeMutation = useGuardedMutation(
    (input: { currentPassword: string; newPassword: string }) =>
      utils.client.auth.changePassword.mutate(input),
    {
      onSuccess: () => {
        setError(null);
        setSaved(true);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setTimeout(() => setSaved(false), 3000);
      },
      onError: (err) => {
        setSaved(false);
        setError(err.message);
      },
    }
  );

  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= NEW_PASSWORD_MIN &&
    confirmPassword.length > 0 &&
    !changeMutation.isPending;

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    setSaved(false);
    if (newPassword.length < NEW_PASSWORD_MIN) {
      setError(`New password must be at least ${NEW_PASSWORD_MIN} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('New password must differ from the current password.');
      return;
    }
    setError(null);
    changeMutation.mutate({ currentPassword, newPassword });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-center gap-2 mb-4">
        <Lock className="w-5 h-5 text-firm-navy" />
        <h2 className="text-base font-semibold text-firm-navy">Change Password</h2>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Update your account password. Enter your current password to confirm the change.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="current-password" className="block text-sm font-medium text-gray-800 mb-1">
            Current Password
          </label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
          />
        </div>
        <div>
          <label htmlFor="new-password" className="block text-sm font-medium text-gray-800 mb-1">
            New Password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
          />
          <p className="text-xs text-gray-500 mt-0.5">At least {NEW_PASSWORD_MIN} characters.</p>
        </div>
        <div>
          <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-800 mb-1">
            Confirm New Password
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
          />
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}
        {saved && <p className="text-green-600 text-sm">Password changed.</p>}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-4 py-2 text-sm bg-accent text-on-accent rounded hover:bg-accent-hover disabled:opacity-50"
          >
            {changeMutation.isPending ? 'Updating…' : 'Update Password'}
          </button>
        </div>
      </form>
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

      <div className="space-y-6">
        {isLoading ? (
          <div className="text-center py-12 text-gray-400 text-sm">Loading settings…</div>
        ) : !data ? (
          <div className="text-center py-12 text-red-600 text-sm">Failed to load settings.</div>
        ) : (
          <>
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
            {/*
             * NOTIFY-SUITE-1 N3. Guarded so a settings payload without the (additive) blob simply omits the
             * panel rather than crashing; settings.get always returns it in production (Zod-defaulted).
             */}
            {data.notificationPreferences && (
              <NotificationPreferencesSection
                key={JSON.stringify(data.notificationPreferences)}
                initial={data.notificationPreferences}
              />
            )}
          </>
        )}
        {/* CONFLICT-TOGGLE-1 Inc 3: the firm conflict-enforcement admin. Self-gates on conflictPolicy.isEnabled
            (dark on prod), so it is rendered unconditionally and returns null when the gate is off. */}
        <ConflictEnforcementSection />
        {/* Password change is independent of settings.get — always available. */}
        <ChangePasswordSection />
      </div>
    </div>
  );
}
