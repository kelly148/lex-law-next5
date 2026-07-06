// @vitest-environment jsdom
/**
 * MATTER-DROP-1 — the matter page's full-page drag-and-drop → Materials (ci-gotchas #10: render).
 *
 * Proves: dragging files over the matter page shows the drop overlay; dropping accepted files ingests each
 * through the shared uploadMaterialFile (the existing /api/materials/upload path) and shows per-file
 * feedback; an unsupported file is rejected with feedback and never uploaded. Mirrors the copilotButton
 * render test's mock scaffold (mocked trpc, stubbed heavy sub-panels).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const uploadSpy = vi.hoisted(() => vi.fn((_f: unknown, _m: unknown, _d?: unknown) => Promise.resolve({ ok: true })));
vi.mock('../../utils/uploadMaterial.js', () => ({ uploadMaterialFile: uploadSpy }));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const query = (data: unknown) => ({
    useQuery: () => { React.useRef(null); return { data, isLoading: false, isError: false, error: null }; },
  });
  const utilsProxy: unknown = new Proxy(function () {}, { get: () => utilsProxy, apply: () => undefined });
  return {
    trpc: {
      useUtils: () => utilsProxy,
      matter: { get: query({ id: 'm1', title: 'Test Matter', phase: 'intake', archivedAt: null, engagementCapacity: 'law_firm', engagementCapacityElectedAt: null }) },
      document: { list: query([]) },
      chatUi: { isEnabled: query({ enabled: false }) },
      chatCopilot: { isEnabled: query({ enabled: false }) },
      deedDraftAgent: { isEnabled: query({ enabled: false }) },
    },
  };
});

vi.mock('../../components/MaterialsDrawer.js', () => ({ default: () => null }));
vi.mock('../../components/MatterStateDashboard.js', () => ({ default: () => null }));
vi.mock('../../components/MatterRecitalBand.js', () => ({ default: () => null }));
vi.mock('../../components/MatterIntakePanel.js', () => ({ default: () => null }));
vi.mock('../../components/GateOverridePanel.js', () => ({ default: () => null }));
vi.mock('../../components/ClosurePackagePanel.js', () => ({ default: () => null }));
vi.mock('../../components/DeadlinePanel.js', () => ({ default: () => null }));
vi.mock('../../components/MatterRecordLedger.js', () => ({ default: () => null }));
vi.mock('../../components/KnowledgeBasePanel.js', () => ({ default: () => null }));
vi.mock('../../components/CapacityElectionPanel.js', () => ({ default: () => null }));

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useParams: () => ({ matterId: 'm1' }),
  useNavigate: () => () => {},
}));

import MatterDetail from '../MatterDetail.js';

const renderPage = () => render(<MemoryRouter initialEntries={['/matters/m1']}><MatterDetail /></MemoryRouter>);

afterEach(() => { cleanup(); uploadSpy.mockClear(); });

describe('MATTER-DROP-1 — page drop → Materials', () => {
  it('shows the drop overlay while dragging files', () => {
    const c = renderPage();
    expect(c.queryByTestId('matter-drop-overlay')).toBeNull();
    fireEvent.dragEnter(c.getByTestId('matter-drop-root'), { dataTransfer: { types: ['Files'] } });
    expect(c.getByTestId('matter-drop-overlay')).toBeTruthy();
  });

  it('dropping an accepted file uploads it via the shared materials path and shows feedback', () => {
    const c = renderPage();
    const file = new File(['hi'], 'notes.txt', { type: 'text/plain' });
    fireEvent.drop(c.getByTestId('matter-drop-root'), { dataTransfer: { files: [file], types: ['Files'] } });
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(uploadSpy.mock.calls[0]![0]).toBe(file);
    expect(uploadSpy.mock.calls[0]![1]).toBe('m1');
    expect(c.getByTestId('matter-drop-results')).toBeTruthy();
  });

  it('an unsupported file type is rejected with feedback and never uploaded', () => {
    const c = renderPage();
    const bad = new File(['x'], 'malware.exe', { type: 'application/x-msdownload' });
    fireEvent.drop(c.getByTestId('matter-drop-root'), { dataTransfer: { files: [bad], types: ['Files'] } });
    expect(uploadSpy).not.toHaveBeenCalled();
    const results = c.getByTestId('matter-drop-results');
    expect(results.textContent).toContain('malware.exe');
    expect(results.textContent).toContain('unsupported');
  });
});
