// @vitest-environment jsdom
/**
 * RELAYOUT-1 — DocumentCanvas + VersionSwitcher render tests.
 *
 * Definition of done is STATE COVERAGE (this surface has gone blank on prod twice, #310 class):
 *   - default landing shows content when a version exists  (the fix)
 *   - a designed empty state when none exists
 *   - NO blank render path: the sheet frame renders in EVERY state
 *   - exactly one oxblood per state (the canvas itself never adds a second oxblood)
 *   - the switcher label matches what the canvas renders
 *
 * Pure components — no tRPC mock needed. Plain DOM assertions (no jest-dom), matching the
 * repo's render-test convention.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import DocumentCanvas, { VersionSwitcher } from '../DocumentCanvas.js';

afterEach(() => cleanup());

const mkVersion = (over: Record<string, unknown> = {}) => ({
  id: 'v2',
  versionNumber: 2,
  content: 'WHEREAS the parties agree to the following terms…',
  createdAt: '2026-06-07T00:00:00.000Z',
  ...over,
});

const noop = () => {};

describe('DocumentCanvas — cardinal rule: the sheet frame ALWAYS renders, never blank', () => {
  it('renders the document body when a version with content is selected (the fix)', () => {
    const { getByTestId, queryByTestId, container } = render(
      <DocumentCanvas
        version={mkVersion()}
        hasAnyVersion
        isGenerating={false}
        statusLabel="draft"
        isViewingCurrent
        currentVersionNumber={2}
        onReturnToCurrent={noop}
      />,
    );
    expect(getByTestId('document-canvas')).toBeTruthy(); // the frame
    expect(getByTestId('canvas-body').textContent).toContain('WHEREAS the parties agree');
    expect(queryByTestId('canvas-empty')).toBeNull();
    expect(queryByTestId('canvas-superseded-ribbon')).toBeNull(); // viewing current
    expect(container.querySelectorAll('.bg-accent').length).toBe(0); // no oxblood in body state
  });

  it('no-version state: designed empty state with exactly one oxblood (Generate draft)', () => {
    const { getByTestId, container } = render(
      <DocumentCanvas
        version={null}
        hasAnyVersion={false}
        isGenerating={false}
        statusLabel=""
        isViewingCurrent={false}
        currentVersionNumber={null}
        onReturnToCurrent={noop}
        emptyStatePrimaryAction={
          <button className="bg-accent text-on-accent">Generate draft</button>
        }
      />,
    );
    expect(getByTestId('document-canvas')).toBeTruthy();
    expect(getByTestId('canvas-empty').textContent).toContain('No draft yet');
    const oxblood = container.querySelectorAll('.bg-accent');
    expect(oxblood.length).toBe(1);
    expect(oxblood[0]!.textContent).toContain('Generate draft');
  });

  it('generating state: in-sheet skeleton + label, never blank, no oxblood', () => {
    const { getByTestId, container } = render(
      <DocumentCanvas
        version={null}
        hasAnyVersion={false}
        isGenerating
        statusLabel=""
        isViewingCurrent={false}
        currentVersionNumber={null}
        onReturnToCurrent={noop}
      />,
    );
    expect(getByTestId('document-canvas')).toBeTruthy();
    expect(getByTestId('canvas-generating').textContent).toContain('Generating draft');
    expect(container.querySelectorAll('.bg-accent').length).toBe(0);
  });

  it('versions-loading state: in-sheet skeleton (Loading…), never the empty "No draft yet" flash', () => {
    const { getByTestId, queryByTestId, container } = render(
      <DocumentCanvas
        version={null}
        hasAnyVersion={false}
        isGenerating={false}
        isLoading
        statusLabel=""
        isViewingCurrent={false}
        currentVersionNumber={null}
        onReturnToCurrent={noop}
      />,
    );
    expect(getByTestId('document-canvas')).toBeTruthy();
    expect(getByTestId('canvas-loading').textContent).toContain('Loading');
    expect(queryByTestId('canvas-empty')).toBeNull(); // must NOT flash "No draft yet" while loading
    expect(container.querySelectorAll('.bg-accent').length).toBe(0);
  });

  it('non-current selection: renders the body + an amber (never red) return-to-current ribbon', () => {
    const onReturn = vi.fn();
    const { getByTestId, container } = render(
      <DocumentCanvas
        version={mkVersion({ id: 'v1', versionNumber: 1, content: 'the prior draft' })}
        hasAnyVersion
        isGenerating={false}
        statusLabel="superseded"
        isViewingCurrent={false}
        currentVersionNumber={2}
        onReturnToCurrent={onReturn}
      />,
    );
    const ribbon = getByTestId('canvas-superseded-ribbon');
    expect(ribbon.textContent).toContain('Viewing v1');
    expect(ribbon.textContent).toContain('v2 is current');
    expect(ribbon.className).toContain('warning'); // amber-advisory token
    expect(ribbon.className).not.toContain('danger'); // never red
    fireEvent.click(ribbon.querySelector('button')!);
    expect(onReturn).toHaveBeenCalledTimes(1);
    expect(getByTestId('canvas-body').textContent).toContain('the prior draft');
    expect(container.querySelectorAll('.bg-accent').length).toBe(0);
  });

  it('empty-body version: in-sheet message + ghost Retry, never blank, never oxblood', () => {
    const onRetry = vi.fn();
    const { getByTestId, container } = render(
      <DocumentCanvas
        version={mkVersion({ content: '   ' })}
        hasAnyVersion
        isGenerating={false}
        statusLabel="draft"
        isViewingCurrent
        currentVersionNumber={2}
        onReturnToCurrent={noop}
        onRetry={onRetry}
      />,
    );
    const box = getByTestId('canvas-empty-body');
    expect(box.textContent).toContain('no readable content');
    fireEvent.click(box.querySelector('button')!);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('.bg-accent').length).toBe(0);
  });

  it('empty state renders the outline scaffold, explicitly labeled not-yet-a-draft', () => {
    const { getByTestId } = render(
      <DocumentCanvas
        version={null}
        hasAnyVersion={false}
        isGenerating={false}
        statusLabel=""
        isViewingCurrent={false}
        currentVersionNumber={null}
        onReturnToCurrent={noop}
        outlineHeadings={['Recitals', 'Grant of authority']}
      />,
    );
    const sc = getByTestId('canvas-outline-scaffold');
    expect(sc.textContent).toContain('Outline preview');
    expect(sc.textContent).toContain('not yet a draft');
    expect(sc.textContent).toContain('Recitals');
  });
});

describe('VersionSwitcher — the label always reflects what the canvas renders', () => {
  const versions = [
    { id: 'v2', versionNumber: 2, createdAt: '2026-06-07T00:00:00.000Z' },
    { id: 'v1', versionNumber: 1, createdAt: '2026-06-06T00:00:00.000Z' },
  ]; // newest-first

  it('button shows the SELECTED version + its derived status', () => {
    const doc = {
      currentVersionId: 'v2',
      officialSubstantiveVersionNumber: 1,
      officialFinalVersionNumber: null,
    };
    const { getByTestId } = render(
      <VersionSwitcher versions={versions} selectedVersionId="v2" doc={doc} onSelect={noop} />,
    );
    expect(getByTestId('version-switcher-button').textContent).toContain('v2 · draft (current)');
  });

  it('reflects a superseded/accepted selection and fires onSelect when another version is chosen', () => {
    const doc = {
      currentVersionId: 'v2',
      officialSubstantiveVersionNumber: 1,
      officialFinalVersionNumber: null,
    };
    const onSelect = vi.fn();
    const { getByTestId } = render(
      <VersionSwitcher versions={versions} selectedVersionId="v1" doc={doc} onSelect={onSelect} />,
    );
    // selected v1 = accepted substantive, not current
    expect(getByTestId('version-switcher-button').textContent).toContain(
      'v1 · accepted substantive',
    );
    fireEvent.click(getByTestId('version-switcher-button'));
    const options = getByTestId('version-switcher-menu').querySelectorAll('[role="option"]');
    expect(options.length).toBe(2);
    fireEvent.click(options[0]!); // newest-first -> v2
    expect(onSelect).toHaveBeenCalledWith('v2');
  });

  it('checkmarks the current version in the menu', () => {
    const doc = {
      currentVersionId: 'v2',
      officialSubstantiveVersionNumber: null,
      officialFinalVersionNumber: null,
    };
    const { getByTestId } = render(
      <VersionSwitcher versions={versions} selectedVersionId="v2" doc={doc} onSelect={noop} />,
    );
    fireEvent.click(getByTestId('version-switcher-button'));
    const menu = getByTestId('version-switcher-menu');
    // the success-tinted check marks the current entry
    expect(menu.querySelector('.text-success')).toBeTruthy();
  });

  it('renders nothing when there are no versions (the canvas owns the empty state)', () => {
    const doc = {
      currentVersionId: null,
      officialSubstantiveVersionNumber: null,
      officialFinalVersionNumber: null,
    };
    const { container } = render(
      <VersionSwitcher versions={[]} selectedVersionId={null} doc={doc} onSelect={noop} />,
    );
    expect(container.querySelector('[data-testid="version-switcher-button"]')).toBeNull();
  });
});
