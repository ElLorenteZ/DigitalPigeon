// Renderer: request form, response view, history list, database status.
// Request and response bodies are untrusted input: rendered as text only, never as HTML (AGENTS.md).
// Before the editor API: the JSON language loads this module lazily, and the editor contributions it imports register
// their services as they load. Loaded after the first editor exists, five of them throw "depends on UNKNOWN service";
// loaded here, they register in time (plan.md, A10).
import 'monaco-editor/internal/common/workers.js';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
// Only the JSON and XML languages.
import { jsonDefaults } from 'monaco-editor/language/json/monaco.contribution.js';
import 'monaco-editor/languages/definitions/xml/register.js';
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  CompletionDoc,
  StoredBody,
  StoredFile,
} from '../core/call-schema';
import {
  type BodyFormatter,
  type BodyKind,
  bodyKind,
  createFormatter,
} from '../core/body-format';
import { toCurl } from '../core/curl';
import { pigeon } from './api';
import { formFromCall } from '../core/form-from-call';
import {
  type Part,
  type PartSummary,
  createPartScanner,
  multipartBoundary,
} from '../core/multipart';
import { composeUrl } from '../core/url';
import { type BodyInput, buildWireRequest } from '../core/wire';
import {
  BODY_PAGE_BYTES,
  type MutationResult,
  type RequestForm,
  type SavedRequestListing,
  type EnvironmentView,
  type SaveEnvironmentInput,
  type CallDetail,
  type CallView,
  type DbStatusView,
  METHODS,
  type SendInput,
  type SendResult,
} from '../shared/ipc-contract';

// Monaco's workers load as bundled files from the server's own origin, which script-src 'self' admits.
// With no getWorker, the editor worker falls back to a blob: URL, which the CSP blocks (plan.md, A2). Once
// getWorker exists Monaco uses it for every label, so the JSON worker is created here too.
self.MonacoEnvironment = {
  getWorker: (_workerId, label) =>
    label === 'json' ? new JsonWorker() : new EditorWorker(),
};

// JSON keeps its highlighting and nothing else. A body read a page at a time is an unfinished document until its
// last page, so diagnostics would mark valid JSON as invalid, and every worker feature would re-parse the whole
// model after each page (code review, finding 4). A shown body is read-only, so the editing features add nothing.
jsonDefaults.setDiagnosticsOptions({ validate: false });
jsonDefaults.setModeConfiguration({
  tokens: true,
  documentFormattingEdits: false,
  documentRangeFormattingEdits: false,
  completionItems: false,
  hovers: false,
  documentSymbols: false,
  colors: false,
  foldingRanges: false,
  diagnostics: false,
  selectionRanges: false,
});

type Row = [string, string];
type Method = SendInput['method'];
// What the form holds; never an environment or saved-request id, which the send adds (code review #10).
type Form = RequestForm;
type Opened = Exclude<CallDetail, { state: 'unreadable' }>;
type CurlOutcome = { command: string; copied: boolean } | { error: string };

const EMPTY_FORM: Form = {
  method: 'GET',
  url: '',
  queryRows: [],
  headerRows: [],
};
// A file row before a file is picked. A picked file always has a name (File.name).
const noFilePicked = (part: Part) =>
  part.kind === 'file' && part.filename === '' && part.bytes.length === 0;
const nonEmpty = (rows: Row[]) => rows.filter(([name]) => name.trim() !== '');
// Nameless rows are ignored, as the form has always done for query and header rows.
const requestOf = (form: Form) => ({
  ...form,
  queryRows: nonEmpty(form.queryRows),
  headerRows: nonEmpty(form.headerRows),
  ...(form.body?.type === 'form'
    ? { body: { type: 'form' as const, rows: nonEmpty(form.body.rows) } }
    : {}),
  ...(form.body?.type === 'multipart'
    ? {
        body: {
          ...form.body,
          parts: form.body.parts.filter(
            (part) => part.name.trim() !== '' && !noFilePicked(part),
          ),
        },
      }
    : {}),
});
const errorText = (error: unknown) =>
  String((error as Error)?.message ?? error);

// What the status line shows: the database's state, or that the server itself did not answer (stopped, or restarted
// with a new token, so this tab's cookie is refused). Code review 2026-11-20, finding 1.
type StatusView = DbStatusView | { status: 'unreachable'; message: string };

// Builds the command and tries the clipboard; the command stays selectable if the clipboard fails.
async function exportCurl(
  request: () => Parameters<typeof toCurl>[0],
): Promise<CurlOutcome> {
  let command: string;
  try {
    command = toCurl(request());
  } catch (error) {
    return { error: errorText(error) };
  }
  try {
    await navigator.clipboard.writeText(command);
    return { command, copied: true };
  } catch {
    return { command, copied: false };
  }
}

const STATUS_POLL_MS = 2000;
// The Undo window after a delete, as in the design (author 2026-11-11).
const UNDO_WINDOW_MS = 8000;
const HISTORY_POLL_MS = 500;
// ignoreBOM keeps a byte order mark on screen: dropping one would hide bytes the record holds.
const textDecoder = () => new TextDecoder('utf-8', { ignoreBOM: true });

export function App() {
  const [status, setStatus] = useState<StatusView | null>(null);
  const [history, setHistory] = useState<CallView[]>([]);
  const [result, setResult] = useState<SendResult | null>(null);
  // Slice 7: the responses to the request of the result shown, and the one picked from them (null: the latest).
  // A response picked from the strip, tagged with the result it was picked under: a pick never outlives its result
  // (code review of responses-strip, 1 and 4).
  const [pickedFor, setPickedFor] = useState<Picked | null>(null);
  // Slice 8: calls deleted but still inside their Undo window are held here, hidden everywhere, and only deleted in
  // the store when their timer ends (author 2026-11-11: "held in the app"). A tab closed inside the window deletes
  // nothing: the call stays.
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  const holdTimers = useRef(new Map<string, number>());
  const [deleteToast, setDeleteToast] = useState<{
    sendId: string;
    error?: string;
  } | null>(null);
  const [inFlightId, setInFlightId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [formCurl, setFormCurl] = useState<CurlOutcome | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [openedCurl, setOpenedCurl] = useState<CurlOutcome | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [environments, setEnvironments] = useState<EnvironmentView[]>([]);
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [environmentsError, setEnvironmentsError] = useState<string | null>(
    null,
  );
  const environment = environments.find((e) => e.id === environmentId);
  // The shell (slice 6): which list the sidebar shows, whether the main area shows the request or an opened call, and
  // whether the environments editor is open under the title bar.
  const [sidebarTab, setSidebarTab] = useState<'saved' | 'history'>('history');
  const [view, setView] = useState<'workspace' | 'call'>('workspace');
  const [environmentsOpen, setEnvironmentsOpen] = useState(false);
  const choiceSaves = useRef<Promise<void>>(Promise.resolve());
  const [savedRequests, setSavedRequests] = useState<SavedRequestListing[]>([]);
  const [savedError, setSavedError] = useState<string | null>(null);
  // The saved request the form came from, and the name the Save buttons use (slice 5).
  const [formLink, setFormLink] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [savedName, setSavedName] = useState('');

  // Whether the list is current: a call's saved request is called deleted only when a loaded list lacks it (#4).
  const [savedListLoaded, setSavedListLoaded] = useState(false);
  // Kept apart from save and delete errors, so a later successful load clears it (second code review, 10).
  const [savedListError, setSavedListError] = useState<string | null>(null);
  const refreshSaved = useCallback(async () => {
    let listed: Awaited<ReturnType<typeof pigeon.listSavedRequests>>;
    try {
      listed = await pigeon.listSavedRequests();
    } catch (error) {
      listed = { ok: false, message: errorText(error) };
    }
    setSavedListLoaded(listed.ok);
    setSavedListError(listed.ok ? null : listed.message);
    if (listed.ok) setSavedRequests(listed.savedRequests);
  }, []);

  // The list and the one shown as active at startup. A choice made since is kept while it still exists.
  const refreshEnvironments = useCallback(async (keepChoice: boolean) => {
    let listed: Awaited<ReturnType<typeof pigeon.listEnvironments>>;
    try {
      listed = await pigeon.listEnvironments();
    } catch (error) {
      listed = { ok: false, message: errorText(error) };
    }
    if (!listed.ok) {
      setEnvironmentsError(listed.message);
      return;
    }
    setEnvironments(listed.environments);
    setEnvironmentId((current) =>
      keepChoice &&
      (current === null || listed.environments.some((e) => e.id === current))
        ? current
        : listed.activeId,
    );
  }, []);
  // A result from an environment action: the reason on failure, and the list read again either way.
  // A call the server does not answer counts as a failure with its reason (code review 2026-11-20, finding 2).
  const afterEnvironmentChange = async (call: Promise<MutationResult>) => {
    const done = await call.catch(
      (error: unknown): MutationResult => ({
        ok: false,
        message: errorText(error),
      }),
    );
    setEnvironmentsError(done.ok ? null : done.message);
    await refreshEnvironments(true);
    return done.ok;
  };

  // Never rejects: a failure is shown above the list (review #3).
  const refreshHistory = useCallback(async () => {
    try {
      const listed = await pigeon.listCalls();
      if (listed.ok) {
        setHistory(listed.calls);
        setHistoryError(null);
      } else {
        setHistoryError(listed.message);
      }
    } catch (error) {
      setHistoryError(String((error as Error)?.message ?? error));
    }
  }, []);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      let next: StatusView;
      try {
        next = await pigeon.dbStatus();
      } catch (error) {
        next = { status: 'unreachable', message: errorText(error) };
      }
      if (active) setStatus(next);
    };
    void poll();
    const timer = setInterval(poll, STATUS_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (status?.status === 'up') void refreshHistory();
  }, [status?.status, refreshHistory]);

  useEffect(() => {
    if (status?.status === 'up') void refreshEnvironments(false);
  }, [status?.status, refreshEnvironments]);

  useEffect(() => {
    if (status?.status === 'up') void refreshSaved();
  }, [status?.status, refreshSaved]);

  // The send document is inserted in main shortly after Send is pressed; re-fetch while the send
  // is in flight so its row appears as "in flight".
  useEffect(() => {
    if (!inFlightId) return;
    const timer = setInterval(() => void refreshHistory(), HISTORY_POLL_MS);
    return () => clearInterval(timer);
  }, [inFlightId, refreshHistory]);

  // Send and Replay differ only in what they ask main to do.
  const run = async (
    invoke: (clientRequestId: string) => Promise<SendResult>,
  ) => {
    endPendingEdit();
    const clientRequestId = crypto.randomUUID();
    setInFlightId(clientRequestId);
    setResult(null);
    try {
      setResult(await invoke(clientRequestId));
    } catch (error) {
      // A rejected invoke is shown, not swallowed (review #2).
      setResult({
        ok: false,
        error: { kind: 'unexpected', message: errorText(error) },
      });
    } finally {
      setInFlightId(null);
      await refreshHistory();
    }
  };

  // The latest Edit decides what the form loads: reading a stored body takes one IPC call per page, and an
  // earlier read finishing later must not replace it (plan.md, phase 6; T2.10). Opening a call also ends a
  // pending Edit, so its result or error never lands under another call.
  // A change to the form or a send also ends it, so a slow read never replaces what was typed meanwhile (code
  // review, 2).
  const latestEdit = useRef(0);
  // The same for opening a saved request: a change to the form, a send or an Edit ends a pending open (code review #2).
  const latestSavedOpen = useRef(0);
  // Bumped whenever the form is replaced (New, an open, an Edit), not when it is typed in. A save that finishes after
  // the form was replaced does not link the new form to what it saved (code review #1).
  const formIdentity = useRef(0);
  const endPendingEdit = () => {
    latestEdit.current += 1;
    latestSavedOpen.current += 1;
    setEditLoading(false);
  };
  const changeForm = (next: Form) => {
    endPendingEdit();
    setForm(next);
  };
  const editCall = async (send: Opened['send']) => {
    const { request } = send;
    latestSavedOpen.current += 1;
    const thisEdit = ++latestEdit.current;
    let storedBody: Uint8Array | undefined;
    if (
      request.body &&
      'fileId' in request.body &&
      isMultipart(request.headers)
    ) {
      setEditError(null);
      setEditLoading(true);
      try {
        storedBody = await readWholeBody(request.body);
      } catch (error) {
        if (thisEdit !== latestEdit.current) return;
        setEditLoading(false);
        setEditError(errorText(error));
        return;
      }
      if (thisEdit !== latestEdit.current) return;
      setEditLoading(false);
    }
    let loaded: ReturnType<typeof formFromCall>;
    try {
      // A call sent against an environment loads its path (plan revision 2, W1).
      loaded = formFromCall(request, {
        storedBody,
        ...(send.environment ? { environment: send.environment } : {}),
      });
    } catch (error) {
      setEditError(errorText(error));
      return;
    }
    setEditError(null);
    // Edit of a call is unlinked: Save then creates a new saved request (author, 2026-11-10).
    formIdentity.current += 1;
    setFormLink(null);
    setSavedName('');
    setForm({ ...loaded, method: loaded.method as Method });
    setFormCurl(null);
    showRequest();
  };

  // Saved requests (slice 5). The latest open decides what the form holds, whichever answer arrives last (T2.10).
  const openSaved = async (id: string) => {
    endPendingEdit();
    const thisOpen = ++latestSavedOpen.current;
    let got: Awaited<ReturnType<typeof pigeon.getSavedRequest>>;
    try {
      got = await pigeon.getSavedRequest(id);
    } catch (error) {
      got = { ok: false, message: errorText(error) };
    }
    if (thisOpen !== latestSavedOpen.current) return;
    if (!got.ok || !got.savedRequest) {
      setSavedError(
        got.ok ? 'That saved request no longer exists' : got.message,
      );
      // The error shows in the workspace's saved bar (code review of workspace-shell, 3).
      setView('workspace');
      return;
    }
    const { savedRequest } = got;
    setSavedError(null);
    formIdentity.current += 1;
    setForm({ ...savedRequest.request });
    setFormLink({ id: savedRequest.id, name: savedRequest.name });
    setSavedName(savedRequest.name);
    setFormCurl(null);
    showRequest();
  };
  // One save at a time: Save and Save as new are unavailable while one is in flight (second code review, 1).
  const [saving, setSaving] = useState(false);
  const saveForm = async (asNew: boolean) => {
    const identity = formIdentity.current;
    setSaving(true);
    const done = await pigeon
      .saveSavedRequest({
        ...(formLink && !asNew ? { id: formLink.id } : {}),
        name: savedName,
        request: requestOf(form),
      })
      .catch((error: unknown) => ({
        ok: false as const,
        message: errorText(error),
      }))
      .finally(() => setSaving(false));
    if (!done.ok) {
      setSavedError(done.message);
      return;
    }
    setSavedError(null);
    if (identity === formIdentity.current) {
      setFormLink({ id: done.id, name: done.name });
    }
    await refreshSaved();
  };
  const newForm = () => {
    setView('workspace');
    formIdentity.current += 1;
    changeForm(EMPTY_FORM);
    setFormLink(null);
    setSavedName('');
    setFormCurl(null);
  };
  const deleteSaved = async (id: string) => {
    const done = await pigeon
      .deleteSavedRequest(id)
      .catch((error: unknown) => ({
        ok: false as const,
        message: errorText(error),
      }));
    setSavedError(done.ok ? null : done.message);
    if (!done.ok) setView('workspace');
    // The form no longer edits a saved request that is gone.
    if (done.ok) {
      setFormLink((current) => (current?.id === id ? null : current));
    }
    await refreshSaved();
  };

  // The latest click decides what is open, whichever answer arrives last.
  const latestOpen = useRef(0);
  const openCall = async (sendId: string) => {
    const thisOpen = ++latestOpen.current;
    endPendingEdit();
    setView('call');
    setOpenedCurl(null);
    setEditError(null);
    setOpenError(null);
    try {
      const got = await pigeon.getCall(sendId);
      if (thisOpen !== latestOpen.current) return;
      if (!got.ok) {
        setOpened(null);
        setOpenError(got.message);
      } else if (!got.call || got.call.state === 'unreadable') {
        setOpened(null);
        setOpenError(got.call ? got.call.error : 'Call not found');
      } else {
        setOpened(got.call);
      }
    } catch (error) {
      if (thisOpen !== latestOpen.current) return;
      setOpened(null);
      setOpenError(errorText(error));
    }
  };

  // The panel renders below the history list, which can be longer than the window: without this, a
  // click on a row appears to do nothing (found in the author's packaged-app check).
  const openedRegion = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (opened || openError) {
      openedRegion.current?.scrollIntoView({ block: 'start' });
    }
  }, [opened, openError]);

  // The panel's Replay and Edit act on the form and the result, which sit above the history list.
  const requestRegion = useRef<HTMLDivElement>(null);
  // The workspace is display:none until the view change commits, so the scroll waits for it (code review of
  // workspace-shell, 2).
  const [requestScroll, setRequestScroll] = useState(0);
  const showRequest = () => {
    setView('workspace');
    setRequestScroll((n) => n + 1);
  };
  useLayoutEffect(() => {
    if (requestScroll > 0) {
      requestRegion.current?.scrollIntoView({ block: 'start' });
    }
  }, [requestScroll]);
  const resultRegion = useRef<HTMLDivElement>(null);

  const canSend = status?.status === 'up';
  const notHeld = (call: CallView) =>
    call.state === 'unreadable' || !held.has(call.send._id);
  const shownHistory = history.filter(notHeld);

  // The strips refresh when History changes: a send, a replay or a completion lands there first (slice 7).
  const historyMark = `${history.length}:${history[0]?.state === 'unreadable' ? history[0].id : (history[0]?.send._id ?? '')}:${history.filter((c) => c.state === 'in-flight').length}`;
  const resultKey = result?.ok
    ? requestKeyOf(result.send.request.method, result.send.request.url)
    : null;
  const responsesList = useResponses(resultKey, historyMark);
  const responses = responsesList.calls.filter(notHeld);
  // Again when the responses strip first appears: it loads after the result and pushes the body down (slice 7).
  const hasResponses = responses.length > 0;
  useEffect(() => {
    if (result) resultRegion.current?.scrollIntoView({ block: 'nearest' });
  }, [result, hasResponses]);
  const openedKey = opened
    ? requestKeyOf(opened.send.request.method, opened.send.request.url)
    : null;
  const otherList = useResponses(openedKey, historyMark);
  const picked =
    result?.ok && pickedFor?.resultId === result.send._id ? pickedFor : null;

  const unhold = (sendId: string) =>
    setHeld((current) => {
      const next = new Set(current);
      next.delete(sendId);
      return next;
    });
  // Hides the call at once and deletes it in the store after the Undo window (slice 8).
  const deleteLater = (sendId: string) => {
    if (holdTimers.current.has(sendId)) return;
    setHeld((current) => new Set(current).add(sendId));
    setDeleteToast({ sendId });
    if (opened?.send._id === sendId) {
      setOpened(null);
      setView('workspace');
    }
    const timer = window.setTimeout(() => {
      holdTimers.current.delete(sendId);
      void (async () => {
        const done = await pigeon.deleteCall(sendId).catch(
          (error: unknown): MutationResult => ({
            ok: false,
            message: errorText(error),
          }),
        );
        if (!done.ok) {
          unhold(sendId);
          setDeleteToast({ sendId, error: done.message });
          return;
        }
        await refreshHistory();
        unhold(sendId);
        setDeleteToast((current) =>
          current?.sendId === sendId ? null : current,
        );
      })();
    }, UNDO_WINDOW_MS);
    holdTimers.current.set(sendId, timer);
  };
  const undoDelete = (sendId: string) => {
    const timer = holdTimers.current.get(sendId);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    holdTimers.current.delete(sendId);
    unhold(sendId);
    setDeleteToast(null);
  };

  // Picking a response loads its completion; the latest is the result itself.
  const latestPick = useRef(0);
  const pickResponse = async (sendId: string) => {
    if (!result?.ok) return;
    const resultId = result.send._id;
    const thisPick = ++latestPick.current;
    if (sendId === resultId) {
      setPickedFor(null);
      return;
    }
    setPickedFor({ resultId, sendId, completion: null, state: 'loading' });
    let next: Picked;
    try {
      const got = await pigeon.getCall(sendId);
      const call = got.ok ? got.call : null;
      next =
        call && call.state !== 'unreadable'
          ? {
              resultId,
              sendId,
              completion: call.completion ?? null,
              state: call.state,
            }
          : {
              resultId,
              sendId,
              completion: null,
              state: 'failed',
              message: !got.ok
                ? got.message
                : call
                  ? call.error
                  : 'Call not found',
            };
    } catch (error) {
      next = {
        resultId,
        sendId,
        completion: null,
        state: 'failed',
        message: errorText(error),
      };
    }
    if (thisPick === latestPick.current) setPickedFor(next);
  };

  const inFlight = inFlightId !== null;

  const chooseEnvironment = (id: string | null) => {
    setEnvironmentId(id);
    // Only what the select shows at the next start; a send names its environment itself (B1). Saved one after
    // another, so the last choice is the one stored (code review #5).
    choiceSaves.current = choiceSaves.current.then(async () => {
      // A failure is shown and does not stop later choices (second code review, 5).
      try {
        const done = await pigeon.setActiveEnvironment(id);
        setEnvironmentsError(done.ok ? null : done.message);
      } catch (error) {
        setEnvironmentsError(errorText(error));
      }
    });
  };

  return (
    <div className="app">
      <header className="title-bar">
        <div className="brand">
          <Logo />
          <h1>DigitalPigeon</h1>
        </div>
        <span className="spacer" />
        <select
          aria-label="Environment"
          className="environment-select"
          value={environmentId ?? ''}
          onChange={(e) => chooseEnvironment(e.target.value || null)}
        >
          <option value="">None</option>
          {environments.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} — {e.baseUrl}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-expanded={environmentsOpen}
          onClick={() => setEnvironmentsOpen((open) => !open)}
        >
          Environments
        </button>
      </header>
      {environmentsError ? (
        // Outside the editor, so a failed choice in the title bar shows with the editor closed (code review of
        // workspace-shell, 1).
        <p
          data-testid="environments-error"
          role="alert"
          className="error environments-error"
        >
          {environmentsError}
        </p>
      ) : null}
      {environmentsOpen ? (
        <div className="environments-panel">
          <EnvironmentsEditor
            environments={environments}
            onSave={(input) =>
              afterEnvironmentChange(pigeon.saveEnvironment(input))
            }
            onDelete={(id) =>
              afterEnvironmentChange(pigeon.deleteEnvironment(id))
            }
          />
        </div>
      ) : null}
      <div className="body">
        <aside className="sidebar">
          <div role="tablist" aria-label="Sidebar" className="sidebar-tabs">
            <button
              type="button"
              role="tab"
              id="tab-saved"
              aria-selected={sidebarTab === 'saved'}
              aria-controls="panel-saved"
              onClick={() => setSidebarTab('saved')}
            >
              Saved
            </button>
            <button
              type="button"
              role="tab"
              id="tab-history"
              aria-selected={sidebarTab === 'history'}
              aria-controls="panel-history"
              onClick={() => setSidebarTab('history')}
            >
              History
            </button>
          </div>
          <div
            role="tabpanel"
            id="panel-saved"
            aria-labelledby="tab-saved"
            className="sidebar-panel"
            hidden={sidebarTab !== 'saved'}
          >
            <SavedRequestList
              savedRequests={savedRequests}
              onOpen={(id) => void openSaved(id)}
              onDelete={(id) => void deleteSaved(id)}
            />
          </div>
          <div
            role="tabpanel"
            id="panel-history"
            aria-labelledby="tab-history"
            className="sidebar-panel"
            hidden={sidebarTab !== 'history'}
          >
            <HistoryList
              calls={shownHistory}
              error={historyError}
              onOpen={(sendId) => void openCall(sendId)}
              onDelete={deleteLater}
            />
          </div>
        </aside>
        <main className="main">
          <div className="workspace" hidden={view !== 'workspace'}>
            {opened ? (
              <button
                type="button"
                className="back"
                onClick={() => setView('call')}
              >
                <span aria-hidden="true">←</span> Back to the call
              </button>
            ) : null}
            <div ref={requestRegion} className="request">
              <SavedRequestBar
                name={savedName}
                link={formLink}
                saving={saving}
                error={savedError ?? savedListError}
                onName={setSavedName}
                onSave={() => void saveForm(false)}
                onSaveAsNew={() => void saveForm(true)}
                onNew={newForm}
              />
              <RequestForm
                form={form}
                onChange={changeForm}
                canSend={canSend}
                inFlight={inFlight}
                onSend={() =>
                  run((clientRequestId) =>
                    pigeon.send({
                      clientRequestId,
                      ...requestOf(form),
                      environmentId,
                      ...(formLink ? { savedRequestId: formLink.id } : {}),
                    }),
                  )
                }
                onCancel={() => inFlightId && pigeon.cancel(inFlightId)}
                onCopyCurl={async () =>
                  setFormCurl(
                    await exportCurl(() => {
                      const request = requestOf(form);
                      return buildWireRequest({
                        ...request,
                        url: composeUrl(request.url, environment),
                      });
                    }),
                  )
                }
              />
              <CurlView testId="form-curl" outcome={formCurl} />
            </div>
            <div ref={resultRegion}>
              <ResultView
                result={result}
                picked={picked}
                strip={
                  responsesList.error ? (
                    <p data-testid="responses-error" className="error">
                      Responses to this request could not be loaded:{' '}
                      {responsesList.error}
                    </p>
                  ) : result?.ok && responses.length > 0 ? (
                    <ResponsesStrip
                      calls={responses}
                      selectedId={picked?.sendId ?? result.send._id}
                      onPick={(id) => void pickResponse(id)}
                      onDelete={deleteLater}
                    />
                  ) : null
                }
              />
            </div>
          </div>
          <div className="call-view" hidden={view !== 'call'}>
            <button
              type="button"
              className="back"
              onClick={() => setView('workspace')}
            >
              <span aria-hidden="true">←</span> Back to the request
            </button>
            <div ref={openedRegion}>
              {openError ? (
                <p data-testid="open-error" className="error">
                  Could not open the call: {openError}
                </p>
              ) : null}
              {opened ? (
                <CallPanel
                  call={opened}
                  canReplay={canSend && !inFlight}
                  curl={openedCurl}
                  editError={editError}
                  editLoading={editLoading}
                  savedRequests={savedRequests}
                  savedListLoaded={savedListLoaded}
                  otherResponses={otherList.calls.filter(
                    (c): c is ReadableCall =>
                      c.state !== 'unreadable' &&
                      c.send._id !== opened.send._id &&
                      !held.has(c.send._id),
                  )}
                  onDelete={() => deleteLater(opened.send._id)}
                  onOpenResponse={(id) => void openCall(id)}
                  onReplay={() => {
                    showRequest();
                    void run((clientRequestId) =>
                      pigeon.replay({
                        clientRequestId,
                        sendId: opened.send._id,
                      }),
                    );
                  }}
                  onEdit={() => void editCall(opened.send)}
                  onCopyCurl={async () =>
                    setOpenedCurl(await exportCurl(() => opened.send.request))
                  }
                />
              ) : null}
            </div>
          </div>
        </main>
      </div>
      {deleteToast ? (
        <div role="status" aria-label="Deleted" className="toast">
          {deleteToast.error ? (
            <>
              <span className="error">
                Could not delete the call: {deleteToast.error}
              </span>
              <button type="button" onClick={() => setDeleteToast(null)}>
                Dismiss
              </button>
            </>
          ) : (
            <>
              <span>Call deleted</span>
              <button
                type="button"
                className="undo"
                onClick={() => undoDelete(deleteToast.sendId)}
              >
                Undo
              </button>
            </>
          )}
        </div>
      ) : null}
      <footer className="status-bar">
        <StatusBar status={status} />
        <span className="note">
          Every send is kept as its own immutable record
        </span>
        <span className="spacer" />
        <span className="version">v0.1 · M1</span>
      </footer>
    </div>
  );
}

function Logo() {
  // Logo Small from the design (Pencil component UWrNk), drawn on a 512 grid.
  return (
    <svg
      className="logo"
      viewBox="0 0 512 512"
      width="24"
      height="24"
      role="img"
      aria-label="DigitalPigeon logo"
    >
      <path
        d="M112 16h288a96 96 0 0 1 96 96v288a96 96 0 0 1-96 96h-288a96 96 0 0 1-96-96v-288a96 96 0 0 1 96-96z"
        fill="#0E1A2B"
      />
      <g
        fill="none"
        stroke="#3DDC97"
        strokeWidth="19"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d="M392 200l-24 0 0 16 24 24 0 48-48 48-112 0-48-48-80 0 0-32 80 0 48-48 64 0 24-24 0-24 16-16 24 0 16 16 0 24z" />
        <path
          d="M248 256l64 0 32 32 0 16m-128-8l88 0m-32 40l0 32m32-32l0 20 12 12m-212-96l-40 0m328-72l40 0"
          strokeOpacity="0.85"
        />
      </g>
      <path
        d="M263 368h18a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-18a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3z m48 0h18a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-18a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3z"
        fill="#3DDC97"
      />
      <path
        d="M339 172a9 9 0 1 0 18 0 9 9 0 1 0-18 0z m-99 84a8 8 0 1 0 16 0 8 8 0 1 0-16 0z m96 48a8 8 0 1 0 16 0 8 8 0 1 0-16 0z m-40-8a8 8 0 1 0 16 0 8 8 0 1 0-16 0z m-240-24a8 8 0 1 0 16 0 8 8 0 1 0-16 0z m368-72a8 8 0 1 0 16 0 8 8 0 1 0-16 0z"
        fill="#0E1A2B"
        stroke="#3DDC97"
        strokeWidth="19"
      />
    </svg>
  );
}

function StatusBar({ status }: { status: StatusView | null }) {
  if (!status) return <p data-testid="db-status">Database: checking…</p>;
  if (status.status === 'unreachable') {
    return (
      <p
        data-testid="db-status"
        data-status="unreachable"
        className="status status-down"
      >
        Database: unknown — the server did not answer ({status.message}). If it
        was stopped or restarted, run npm start again.
      </p>
    );
  }
  const text = {
    connecting: 'connecting…',
    up: `up (${status.database ?? ''})`,
    down: 'not running — start it with docker compose up -d',
    'not-configured': `not configured — ${status.detail ?? status.configPath}`,
  }[status.status];
  return (
    <p
      data-testid="db-status"
      data-status={status.status}
      className={`status status-${status.status}`}
    >
      Database: {text}
    </p>
  );
}

function RowsEditor({
  label,
  rows,
  onChange,
}: {
  label: string;
  rows: Row[];
  onChange: (rows: Row[]) => void;
}) {
  const update = (index: number, column: 0 | 1, value: string) =>
    onChange(
      rows.map((row, i) =>
        i === index ? (column === 0 ? [value, row[1]] : [row[0], value]) : row,
      ),
    );
  return (
    <fieldset>
      <legend>{label}</legend>
      {rows.map((row, index) => (
        <div key={index} className="row">
          <input
            aria-label={`${label} name ${index + 1}`}
            value={row[0]}
            onChange={(e) => update(index, 0, e.target.value)}
          />
          <input
            aria-label={`${label} value ${index + 1}`}
            value={row[1]}
            onChange={(e) => update(index, 1, e.target.value)}
          />
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, ['', '']])}>
        Add {label.toLowerCase()}
      </button>
    </fieldset>
  );
}

const BODY_TYPES = [
  ['none', 'None'],
  ['json', 'JSON'],
  ['xml', 'XML'],
  ['text', 'Text'],
  ['form', 'Form'],
  ['multipart', 'Multipart'],
] as const;

// JSON, XML and Text share one text box, so changing between them keeps what was typed.
function bodyOfType(type: BodyInput['type'], current: BodyInput): BodyInput {
  if (type === 'none') return { type };
  if (type === 'form') {
    return current.type === 'form' ? current : { type, rows: [] };
  }
  if (type === 'multipart') {
    return current.type === 'multipart' ? current : { type, parts: [] };
  }
  return { type, text: 'text' in current ? current.text : '' };
}

function BodyEditor({
  body,
  onChange,
}: {
  body: BodyInput;
  onChange: (body: BodyInput) => void;
}) {
  return (
    <fieldset className="body-editor-fields">
      <legend>Body</legend>
      {/* Pressed buttons, not radios: an arrow key on a radio changes the type, and the body with it (code review of
          workspace-shell, 4). */}
      <div role="group" aria-label="Body type" className="segment">
        {BODY_TYPES.map(([type, label]) => (
          <button
            key={type}
            type="button"
            data-type={type}
            aria-pressed={body.type === type}
            onClick={() => {
              if (body.type !== type) onChange(bodyOfType(type, body));
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {'text' in body ? (
        <textarea
          aria-label="Body text"
          rows={8}
          value={body.text}
          onChange={(e) => onChange({ ...body, text: e.target.value })}
        />
      ) : null}
      {body.type === 'form' ? (
        <RowsEditor
          label="Form field"
          rows={body.rows}
          onChange={(rows) => onChange({ type: 'form', rows })}
        />
      ) : null}
      {body.type === 'multipart' ? (
        <PartsEditor
          parts={body.parts}
          onChange={(parts) => onChange({ ...body, parts })}
        />
      ) : null}
    </fieldset>
  );
}

const sizeText = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;

// Text fields and files, in order. A file is read whole when it is picked, so the part holds its bytes and
// the request no longer depends on the file (plan.md, phase 5).
// Row ids live outside React state: a row keeps its id while it exists, so a file read that finishes after
// rows were added or removed still lands in its own row, and each file input stays with its part (code
// review, 1 and 7).
let nextPartRowId = 1;

function PartsEditor({
  parts,
  onChange,
}: {
  parts: Part[];
  onChange: (parts: Part[]) => void;
}) {
  const ids = useRef<number[]>([]);
  // Parts replaced from outside (Edit, switching body type) get fresh rows.
  if (ids.current.length !== parts.length) {
    ids.current = parts.map(() => nextPartRowId++);
  }
  // The latest parts and onChange, for a read that finishes after later renders: onChange carries the
  // latest form, so a read never reverts what was typed while it ran.
  const latest = useRef({ parts, onChange });
  latest.current = { parts, onChange };

  // Read failures by row id, shown beside the file input.
  const [readErrors, setReadErrors] = useState<Map<number, string>>(new Map());
  const setError = (id: number, message: string | undefined) =>
    setReadErrors((current) => {
      const next = new Map(current);
      if (message === undefined) next.delete(id);
      else next.set(id, message);
      return next;
    });

  const changeRow = (id: number, change: (part: Part) => Part) => {
    const index = ids.current.indexOf(id);
    if (index === -1) return; // removed while a file was read
    const { parts: current, onChange: apply } = latest.current;
    apply(current.map((part, i) => (i === index ? change(part) : part)));
  };

  const pick = async (id: number, file: File | undefined) => {
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setError(id, undefined);
      changeRow(id, (part) => ({
        kind: 'file',
        name: part.name,
        filename: file.name,
        contentType: file.type,
        bytes,
      }));
    } catch (error) {
      setError(id, `Could not read ${file.name}: ${errorText(error)}`);
      changeRow(id, (part) => ({
        kind: 'file',
        name: part.name,
        filename: '',
        contentType: '',
        bytes: new Uint8Array(),
      }));
    }
  };

  const add = (part: Part) => {
    ids.current = [...ids.current, nextPartRowId++];
    onChange([...parts, part]);
  };

  return (
    <fieldset>
      <legend>Parts</legend>
      {parts.map((part, index) => {
        const n = index + 1;
        const id = ids.current[index] ?? -1;
        return (
          <div key={id} className="row">
            <input
              aria-label={`Part name ${n}`}
              value={part.name}
              onChange={(e) => {
                const name = e.target.value;
                changeRow(id, (p) => ({ ...p, name }));
              }}
            />
            {part.kind === 'field' ? (
              <input
                aria-label={`Part value ${n}`}
                value={part.value}
                onChange={(e) => {
                  const value = e.target.value;
                  changeRow(id, (p) =>
                    p.kind === 'field' ? { ...p, value } : p,
                  );
                }}
              />
            ) : (
              <>
                <input
                  // A part whose file changed from outside (Edit) gets a fresh input, not the last one picked.
                  key={`${part.filename}:${part.bytes.length}`}
                  type="file"
                  aria-label={`Part file ${n}`}
                  onChange={(e) => void pick(id, e.target.files?.[0])}
                />
                <span data-testid={`part-file-${n}`}>
                  {noFilePicked(part)
                    ? 'No file'
                    : `${part.filename} · ${part.contentType || 'application/octet-stream'} · ${sizeText(part.bytes.length)}`}
                </span>
                {readErrors.has(id) ? (
                  <span role="alert">{readErrors.get(id)}</span>
                ) : null}
              </>
            )}
            <button
              type="button"
              onClick={() => {
                ids.current = ids.current.filter((_, i) => i !== index);
                setError(id, undefined);
                onChange(parts.filter((_, i) => i !== index));
              }}
            >
              Remove
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => add({ kind: 'field', name: '', value: '' })}
      >
        Add field
      </button>
      <button
        type="button"
        onClick={() =>
          add({
            kind: 'file',
            name: '',
            filename: '',
            contentType: '',
            bytes: new Uint8Array(),
          })
        }
      >
        Add file
      </button>
    </fieldset>
  );
}

// The form's name for saving, and its link to the saved request it came from (slice 5).
function SavedRequestBar({
  name,
  link,
  saving,
  error,
  onName,
  onSave,
  onSaveAsNew,
  onNew,
}: {
  name: string;
  link: { id: string; name: string } | null;
  saving: boolean;
  error: string | null;
  onName: (name: string) => void;
  onSave: () => void;
  onSaveAsNew: () => void;
  onNew: () => void;
}) {
  return (
    <div className="saved-bar">
      <input
        aria-label="Saved request name"
        placeholder="Name"
        value={name}
        onChange={(e) => onName(e.target.value)}
      />
      <button type="button" onClick={onSave} disabled={saving}>
        Save
      </button>
      <button type="button" onClick={onSaveAsNew} disabled={!link || saving}>
        Save as new
      </button>
      <button type="button" onClick={onNew}>
        New
      </button>
      {link ? (
        <span data-testid="saved-request-link">
          Editing saved request: {link.name}
        </span>
      ) : null}
      {error ? (
        <span data-testid="saved-requests-error" role="alert" className="error">
          {error}
        </span>
      ) : null}
    </div>
  );
}

// One flat list, by name (ADR 0001). Names may repeat; method and URL tell entries apart (plan revision 2, W2).
function SavedRequestList({
  savedRequests,
  onOpen,
  onDelete,
}: {
  savedRequests: SavedRequestListing[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="saved">
      <div className="title-row">
        <h2>Saved requests</h2>
        <span className="count">{savedRequests.length} saved</span>
      </div>
      <ol data-testid="saved-requests" className="saved-list">
        {savedRequests.map((s) => (
          <li key={s.id} className="row">
            <button type="button" onClick={() => onOpen(s.id)}>
              {s.name} — {s.method} {s.url}
            </button>
            <button type="button" onClick={() => onDelete(s.id)}>
              Delete
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

// Saved environments, editable in place, and a row to add one (slice 5). Rows are listed by name; names may repeat.
function EnvironmentsEditor({
  environments,
  onSave,
  onDelete,
}: {
  environments: EnvironmentView[];
  /** Resolves true when saved; on false the reason is shown and the fields keep what was typed. */
  onSave: (input: SaveEnvironmentInput) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [drafts, setDrafts] = useState<
    Record<string, { name: string; baseUrl: string }>
  >({});
  const [newName, setNewName] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('');
  const draftOf = (e: EnvironmentView) => drafts[e.id] ?? e;
  const setDraft = (id: string, draft: { name: string; baseUrl: string }) =>
    setDrafts((current) => ({ ...current, [id]: draft }));
  const dropDraft = (id: string) =>
    setDrafts(({ [id]: _dropped, ...rest }) => rest);

  return (
    <section data-testid="environments">
      <h2>Environments</h2>
      <ol>
        {environments.map((e, index) => {
          const n = index + 1;
          const draft = draftOf(e);
          return (
            <li key={e.id} className="row">
              <input
                aria-label={`Environment name ${n}`}
                value={draft.name}
                onChange={(ev) =>
                  setDraft(e.id, { ...draft, name: ev.target.value })
                }
              />
              <input
                aria-label={`Environment base address ${n}`}
                value={draft.baseUrl}
                onChange={(ev) =>
                  setDraft(e.id, { ...draft, baseUrl: ev.target.value })
                }
              />
              <button
                type="button"
                aria-label={`Save environment ${n}`}
                onClick={async () => {
                  if (await onSave({ id: e.id, ...draft })) {
                    // Only the draft that was saved; one typed during the save stays.
                    setDrafts(({ [e.id]: current, ...rest }) =>
                      current === draft || current === undefined
                        ? rest
                        : { ...rest, [e.id]: current },
                    );
                  }
                }}
              >
                Save
              </button>
              <button
                type="button"
                aria-label={`Delete environment ${n}`}
                onClick={async () => {
                  if (await onDelete(e.id)) dropDraft(e.id);
                }}
              >
                Delete
              </button>
            </li>
          );
        })}
      </ol>
      <div className="row">
        <input
          aria-label="New environment name"
          placeholder="Name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <input
          aria-label="New environment base address"
          placeholder="https://…"
          value={newBaseUrl}
          onChange={(e) => setNewBaseUrl(e.target.value)}
        />
        <button
          type="button"
          onClick={async () => {
            const saved = { name: newName, baseUrl: newBaseUrl };
            // Cleared only if unchanged since: typing during the save is kept (async state, slice 4 CR1/CR2).
            if (await onSave(saved)) {
              setNewName((current) => (current === saved.name ? '' : current));
              setNewBaseUrl((current) =>
                current === saved.baseUrl ? '' : current,
              );
            }
          }}
        >
          Add environment
        </button>
      </div>
    </section>
  );
}

function RequestForm({
  form,
  onChange,
  canSend,
  inFlight,
  onSend,
  onCancel,
  onCopyCurl,
}: {
  form: Form;
  onChange: (form: Form) => void;
  canSend: boolean;
  inFlight: boolean;
  onSend: () => void;
  onCancel: () => void;
  onCopyCurl: () => void;
}) {
  // Screen 01 opens on Body. Panels stay mounted while hidden, so what was typed and the editor survive a switch.
  const [tab, setTab] = useState<'query' | 'headers' | 'body'>('body');
  const body = form.body ?? { type: 'none' };
  const tabs = [
    ['query', 'Query', String(form.queryRows.length)],
    ['headers', 'Headers', String(form.headerRows.length)],
    ['body', 'Body', BODY_TYPES.find(([t]) => t === body.type)?.[1] ?? ''],
  ] as const;
  return (
    <form
      className="request-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!inFlight) onSend();
      }}
    >
      <div className="request-bar">
        <div className="url-field">
          <select
            aria-label="Method"
            className="method-select"
            value={form.method}
            onChange={(e) =>
              onChange({ ...form, method: e.target.value as Method })
            }
          >
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <input
            aria-label="URL"
            className="url"
            placeholder="https://… or /path, sent to the environment"
            value={form.url}
            onChange={(e) => onChange({ ...form, url: e.target.value })}
          />
        </div>
        <button type="button" className="secondary" onClick={onCopyCurl}>
          Copy as curl
        </button>
        {inFlight ? (
          <button type="button" className="primary" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <button type="submit" className="primary" disabled={!canSend}>
            Send
          </button>
        )}
      </div>
      <div role="tablist" aria-label="Request" className="tabs">
        {tabs.map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`request-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`request-panel-${id}`}
            onClick={() => setTab(id)}
          >
            {label} <span className="count">{count}</span>
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="request-panel-query"
        aria-label="Query"
        hidden={tab !== 'query'}
      >
        <RowsEditor
          label="Query"
          rows={form.queryRows}
          onChange={(queryRows) => onChange({ ...form, queryRows })}
        />
      </div>
      <div
        role="tabpanel"
        id="request-panel-headers"
        aria-label="Headers"
        hidden={tab !== 'headers'}
      >
        <RowsEditor
          label="Header"
          rows={form.headerRows}
          onChange={(headerRows) => onChange({ ...form, headerRows })}
        />
      </div>
      <div
        role="tabpanel"
        id="request-panel-body"
        aria-label="Body"
        hidden={tab !== 'body'}
      >
        <BodyEditor
          body={body}
          onChange={(next) => onChange({ ...form, body: next })}
        />
      </div>
    </form>
  );
}

function CurlView({
  testId,
  outcome,
}: {
  testId: string;
  outcome: CurlOutcome | null;
}) {
  if (!outcome) return null;
  if ('error' in outcome) {
    return (
      <p data-testid={`${testId}-error`} className="error">
        Cannot export as curl: {outcome.error}
      </p>
    );
  }
  return (
    <div>
      <p>{outcome.copied ? 'Copied.' : 'Select the command to copy it:'}</p>
      <pre data-testid={testId}>{outcome.command}</pre>
    </div>
  );
}

// Everything here is rendered as text: request and response content is untrusted (AGENTS.md).
const boundaryOf = (headers: readonly (readonly [string, string])[]) =>
  multipartBoundary(
    headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? '',
  );
const isMultipart = (headers: readonly (readonly [string, string])[]) =>
  boundaryOf(headers) !== undefined;

// A stored body, whole, for Edit. Page by page through readBody; a short or failed read is an error.
async function readWholeBody(body: StoredFile): Promise<Uint8Array> {
  const whole = new Uint8Array(body.length);
  let offset = 0;
  while (offset < body.length) {
    const got = await pigeon.readBody({
      fileId: body.fileId,
      offset,
      length: Math.min(BODY_PAGE_BYTES, body.length - offset),
    });
    if (!got.ok) throw new Error(got.message);
    if (got.bytes.length === 0) {
      throw new Error(`The stored body ${body.fileId} ends early`);
    }
    whole.set(got.bytes, offset);
    offset += got.bytes.length;
  }
  return whole;
}

type PartsOutcome =
  | { state: 'loading' }
  | { state: 'listed'; parts: PartSummary[] }
  | { state: 'failed'; message: string };

function scanInline(bytes: Uint8Array, boundary: string): PartsOutcome {
  try {
    const scanner = createPartScanner(boundary);
    return {
      state: 'listed',
      parts: [...scanner.push(bytes), ...scanner.end()],
    };
  } catch (error) {
    return { state: 'failed', message: errorText(error) };
  }
}

// One line per part, above the raw body. An inline body is scanned here; a stored one is listed by main,
// which reads it a page at a time (describeBody).
function PartsList({
  body,
  headers,
}: {
  body: StoredBody;
  headers: [string, string][];
}) {
  const boundary = boundaryOf(headers) ?? '';
  const fileId = 'fileId' in body ? body.fileId : null;
  const inline = useMemo(
    () => ('fileId' in body ? null : scanInline(body, boundary)),
    [body, boundary],
  );
  const [stored, setStored] = useState<PartsOutcome>({ state: 'loading' });
  useEffect(() => {
    if (fileId === null) return;
    let current = true;
    setStored({ state: 'loading' });
    pigeon
      .describeBody({ fileId, boundary })
      .then(
        (got): PartsOutcome =>
          got.ok
            ? { state: 'listed', parts: got.parts }
            : { state: 'failed', message: got.message },
        (error: unknown): PartsOutcome => ({
          state: 'failed',
          message: errorText(error),
        }),
      )
      .then((outcome) => {
        if (current) setStored(outcome);
      });
    return () => {
      current = false;
    };
  }, [fileId, boundary]);

  const outcome = inline ?? stored;
  return (
    <section data-testid="call-request-parts">
      <h4>Parts</h4>
      {outcome.state === 'loading' ? <p>Listing parts…</p> : null}
      {outcome.state === 'failed' ? (
        <p className="error">Could not list the parts: {outcome.message}</p>
      ) : null}
      {outcome.state === 'listed' ? (
        <ol>
          {outcome.parts.map((part, index) => (
            <li key={index}>
              {part.filename === undefined
                ? `${part.name} · text · ${sizeText(part.length)}`
                : `${part.name} · ${part.filename} · ${part.contentType ?? 'no type'} · ${sizeText(part.length)}`}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function CallPanel({
  call,
  canReplay,
  curl,
  editError,
  editLoading,
  savedRequests,
  savedListLoaded,
  otherResponses,
  onOpenResponse,
  onDelete,
  onReplay,
  onEdit,
  onCopyCurl,
}: {
  call: Opened;
  canReplay: boolean;
  curl: CurlOutcome | null;
  editError: string | null;
  editLoading: boolean;
  savedRequests: SavedRequestListing[];
  savedListLoaded: boolean;
  otherResponses: ReadableCall[];
  onOpenResponse: (sendId: string) => void;
  onDelete: () => void;
  onReplay: () => void;
  onEdit: () => void;
  onCopyCurl: () => void;
}) {
  const { method, url, headers, body } = call.send.request;
  const response =
    call.completion && 'response' in call.completion
      ? call.completion.response
      : null;
  const auth = headers.find(([n]) => n.toLowerCase() === 'authorization');
  return (
    <section
      data-testid="call-panel"
      data-state={call.state}
      className="call-record"
    >
      <div className="call-top">
        <div className="call-title">
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <span>History</span>
            <span aria-hidden="true">›</span>
            <h2>Call</h2>
            <code>#{shortId(call.send._id)}</code>
          </nav>
          <p data-testid="call-request-line" className="call-request-line">
            <span className={`method-text method-${method.toLowerCase()}`}>
              {method}
            </span>{' '}
            <span className="call-url">{url}</span>
            <span className="call-sent">
              {' '}
              · sent {call.send.sentAt.toLocaleString()}
            </span>
          </p>
        </div>
        <div className="call-actions">
          <button
            type="button"
            className="secondary danger"
            onClick={onDelete}
            disabled={call.state === 'in-flight'}
          >
            Delete
          </button>
          <button type="button" className="secondary" onClick={onCopyCurl}>
            Copy call as curl
          </button>
          <button type="button" className="secondary" onClick={onEdit}>
            Edit
          </button>
          <button
            type="button"
            className="primary"
            onClick={onReplay}
            disabled={!canReplay}
          >
            Replay
          </button>
        </div>
      </div>
      <div className="chips">
        {response ? (
          <span className={`status-pill ${statusClass(response.status)}`}>
            {statusLabel(response.status)}
          </span>
        ) : null}
        <span className="chip" data-testid="call-state">
          {stateText(call.state)}
        </span>
        {call.completion ? (
          <span className="chip mono">
            {Math.round(call.completion.durationMs)} ms
          </span>
        ) : null}
        {call.send.environment ? (
          <span className="chip" data-testid="call-environment">
            Environment: {call.send.environment.name} —{' '}
            {call.send.environment.baseUrl}
          </span>
        ) : null}
        {call.send.savedRequestId ? (
          <span className="chip" data-testid="call-saved-request">
            {(() => {
              const source = savedRequests.find(
                (s) => s.id === call.send.savedRequestId,
              );
              if (source) return `From saved request: ${source.name}`;
              return savedListLoaded
                ? 'From a deleted saved request'
                : 'From a saved request';
            })()}
          </span>
        ) : null}
        {auth ? (
          <span className="chip mono">
            Authorization: {abbreviate(auth[1])}
          </span>
        ) : null}
      </div>
      {otherResponses.length > 0 ? (
        <div data-testid="other-responses" className="other-responses">
          <span className="label">
            Other responses to {method} {requestKeyOf(method, url).path}
          </span>
          {otherResponses.map((other) => (
            <ResponseChip
              key={other.send._id}
              call={other}
              onClick={() => onOpenResponse(other.send._id)}
            />
          ))}
        </div>
      ) : null}
      {editLoading ? (
        <p data-testid="call-edit-status">Loading the call into the form…</p>
      ) : null}
      {editError ? (
        <p data-testid="call-edit-error" className="error">
          Cannot edit this call: {editError}
        </p>
      ) : null}
      <CurlView testId="call-curl" outcome={curl} />
      <p className="immutable-note">
        Replaying or editing never changes this record — each send creates a new
        entry in History.
      </p>
      <div className="call-columns">
        <div className="call-column">
          <div className="column-head">
            <h3>Request as sent</h3>
            <span className="mono faint">
              sent {call.send.sentAt.toLocaleTimeString()}
            </span>
          </div>
          <p className="label">Headers · {headers.length}</p>
          <HeaderTable testId="call-request-headers" headers={headers} />
          <p className="label">Body</p>
          {body && isMultipart(headers) ? (
            <PartsList body={body} headers={headers} />
          ) : null}
          {body ? (
            <BodyText
              testId="call-request-body"
              body={body}
              headers={headers}
            />
          ) : (
            <p className="empty">No body was sent with this request</p>
          )}
        </div>
        <div className="call-column">
          {call.completion ? (
            <>
              <div className="column-head">
                <h3>Response</h3>
                <span className="mono faint" data-testid="call-completed-at">
                  completed {call.completion.completedAt.toLocaleString()}
                </span>
              </div>
              <CompletionView
                key={call.completion._id}
                completion={call.completion}
                heading={false}
              />
            </>
          ) : (
            <p className="empty">No response was recorded</p>
          )}
        </div>
      </div>
    </section>
  );
}

const shortId = (id: string) =>
  id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;

// A long header value shown as its start and end, as the design's Authorization chip does.
const abbreviate = (value: string) =>
  value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-4)}` : value;

function stateText(state: Opened['state']): string {
  if (state === 'in-flight') return 'In flight';
  if (state === 'interrupted') return 'Interrupted: no response was recorded';
  return 'Completed';
}

function ResultView({
  result,
  picked,
  strip,
}: {
  result: SendResult | null;
  /** A response picked from the strip, while it loads and after. */
  picked: Picked | null;
  strip: ReactNode;
}) {
  if (!result) return null;
  if (!result.ok) {
    return (
      <section data-testid="result" className="error">
        <p>
          {result.error.kind === 'not-recorded'
            ? 'Response received but NOT recorded'
            : 'Not sent'}
          : {result.error.message}
        </p>
        {result.completion ? (
          <CompletionView
            key={result.completion._id}
            completion={result.completion}
          />
        ) : null}
      </section>
    );
  }
  const shown = picked ? picked.completion : result.completion;
  return (
    <section data-testid="result">
      {shown ? (
        <CompletionView key={shown._id} completion={shown} strip={strip} />
      ) : (
        <>
          {strip}
          {picked ? (
            <p className="empty" data-testid="picked-state">
              {pickedText(picked)}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

// The request a call answers: its method and URL path (query, fragment and host left out; slice 7).
function requestKeyOf(method: string, url: string) {
  let path = '/';
  try {
    path = new URL(url).pathname || '/';
  } catch {
    path = url.split(/[?#]/)[0] || '/';
  }
  return {
    method: method as Method,
    path: path.startsWith('/') ? path : `/${path}`,
  };
}

type Picked = {
  resultId: string;
  sendId: string;
  completion: CompletionDoc | null;
  state: 'loading' | 'failed' | ReadableCall['state'];
  message?: string;
};

// What the response area says for a picked call with no completion to show (code review of responses-strip, 3).
function pickedText(picked: Picked): string {
  if (picked.state === 'loading') return 'Loading the response…';
  if (picked.state === 'in-flight') return 'In flight: no response yet';
  if (picked.state === 'failed') {
    return `The response could not be loaded: ${picked.message ?? ''}`;
  }
  return 'No response was recorded for this call';
}

// The responses to one request, tagged with it: a list for another request, or for an earlier failure, is never
// returned for this one (code review of responses-strip, 2 and 7).
function useResponses(
  key: { method: Method; path: string } | null,
  refresh: string,
): { calls: CallView[]; error: string | null } {
  const text = key ? `${key.method} ${key.path}` : '';
  const [state, setState] = useState<{
    key: string;
    calls: CallView[];
    error: string | null;
  }>({ key: '', calls: [], error: null });
  useEffect(() => {
    if (!key) return;
    let active = true;
    pigeon
      .listResponses(key)
      .then((listed) => {
        if (!active) return;
        setState(
          listed.ok
            ? { key: text, calls: listed.calls, error: null }
            : { key: text, calls: [], error: listed.message },
        );
      })
      .catch((error: unknown) => {
        if (active) setState({ key: text, calls: [], error: errorText(error) });
      });
    return () => {
      active = false;
    };
    // `key` is a new object on each render; its text identifies it.
  }, [text, refresh]);
  return state.key === text && key
    ? { calls: state.calls, error: state.error }
    : { calls: [], error: null };
}

// "Responses to this request" (screen 01): one chip per response, newest first, the one shown pressed.
function ResponsesStrip({
  calls,
  selectedId,
  onPick,
  onDelete,
}: {
  calls: CallView[];
  selectedId: string;
  onPick: (sendId: string) => void;
  onDelete: (sendId: string) => void;
}) {
  const readable = calls.filter(
    (c): c is ReadableCall => c.state !== 'unreadable',
  );
  return (
    <div data-testid="responses-strip" className="responses-strip">
      <span className="strip-label">
        <strong>Responses to this request</strong>
        <span>{readable.length} kept</span>
      </span>
      {readable.map((call) => (
        <span key={call.send._id} className="chip-group">
          <ResponseChip
            call={call}
            pressed={call.send._id === selectedId}
            onClick={() => onPick(call.send._id)}
          />
          <button
            type="button"
            className="chip-delete"
            aria-label={`Delete response ${codeText(call)} ${call.send.sentAt.toLocaleTimeString()}`}
            onClick={() => onDelete(call.send._id)}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

function ResponseChip({
  call,
  pressed,
  onClick,
}: {
  call: ReadableCall;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="response-chip"
      aria-pressed={pressed}
      onClick={onClick}
    >
      <span className={`dot ${outcomeClass(call)}`} aria-hidden="true" />
      <span className={`code ${outcomeClass(call)}`}>{codeText(call)}</span>
      <span className="time">{call.send.sentAt.toLocaleTimeString()}</span>
      <span className="duration">{durationText(call)}</span>
    </button>
  );
}

// The response as screen 01 shows it: a header row with the status pill, duration, size and when it was recorded, then
// Body and Headers tabs. Panels stay mounted, so the body editor keeps its place across a switch.
function CompletionView({
  completion,
  heading = true,
  strip = null,
}: {
  completion: CompletionDoc;
  /** The responses strip, under the header (slice 7). */
  strip?: ReactNode;
  /** The call record names the column itself, so it leaves this heading out. */
  heading?: boolean;
}) {
  const [tab, setTab] = useState<'body' | 'headers'>('body');
  const duration = `${Math.round(completion.durationMs)} ms`;
  if ('error' in completion) {
    return (
      <div className="response">
        <div className="response-header">
          {heading ? <h2>Response</h2> : null}
          <span className="status-pill err">{completion.error.code}</span>
        </div>
        {strip}
        <p data-testid="response-error">
          {completion.error.code}: {completion.error.message} ({duration})
        </p>
      </div>
    );
  }
  const { status, headers, body } = completion.response;
  return (
    <div className="response">
      <div className="response-header">
        {heading ? <h2>Response</h2> : null}
        <span
          data-testid="response-status"
          className={`status-pill ${statusClass(status)}`}
        >
          {statusLabel(status)}
          <span className="sr-only"> · {duration}</span>
        </span>
        <span className="meta">{duration}</span>
        <span className="meta">{sizeText(body.length)}</span>
        <span className="spacer" />
        <span className="recorded-chip">
          Recorded · {completion.completedAt.toLocaleString()}
        </span>
      </div>
      {strip}
      <div role="tablist" aria-label="Response" className="tabs">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'body'}
          onClick={() => setTab('body')}
        >
          Body
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'headers'}
          onClick={() => setTab('headers')}
        >
          Headers <span className="count">{headers.length}</span>
        </button>
      </div>
      <div
        role="tabpanel"
        aria-label="Response headers"
        hidden={tab !== 'headers'}
      >
        <HeaderTable testId="response-headers" headers={headers} />
      </div>
      <div role="tabpanel" aria-label="Response body" hidden={tab !== 'body'}>
        <BodyText testId="response-body" body={body} headers={headers} />
      </div>
    </div>
  );
}

const statusClass = (status: number) =>
  status >= 500
    ? 'err'
    : status >= 400
      ? 'warn'
      : status >= 300
        ? 'info'
        : 'ok';

const statusLabel = (status: number) =>
  STATUS_TEXT[status] ? `${status} ${STATUS_TEXT[status]}` : String(status);

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

// Headers as the design's key/value table: names in the accent colour, values beside them, in mono.
function HeaderTable({
  testId,
  headers,
}: {
  testId: string;
  headers: [string, string][];
}) {
  return (
    <dl data-testid={testId} className="header-table">
      {headers.map(([name, value], index) => (
        <div key={index}>
          <dt>
            {name}
            <span className="sr-only">: </span>
          </dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// A body in its document is shown whole; one in a file is shown a page at a time.
function BodyText({
  testId,
  body,
  headers,
}: {
  testId: string;
  body: StoredBody;
  headers: Row[];
}) {
  return (
    // Keyed per body: a body that failed to show must not leave its error on the next call opened in the same place
    // (code review, finding 1).
    <BodyBoundary key={bodyKey(body)} testId={testId}>
      {'fileId' in body ? (
        // One instance per file: an answer for a body no longer shown reaches an unmounted instance.
        <PagedBodyText
          key={body.fileId}
          testId={testId}
          file={body}
          kind={bodyKind(headers)}
        />
      ) : (
        <InlineBodyText testId={testId} bytes={body} kind={bodyKind(headers)} />
      )}
    </BodyBoundary>
  );
}

// A stored body is identified by its file; an inline one by its bytes, which a call opened again receives anew.
const inlineBodyKeys = new WeakMap<Uint8Array, string>();
let inlineBodiesSeen = 0;
function bodyKey(body: StoredBody): string {
  if ('fileId' in body) return `file:${body.fileId}`;
  let key = inlineBodyKeys.get(body);
  if (!key) {
    inlineBodiesSeen += 1;
    key = `inline:${inlineBodiesSeen}`;
    inlineBodyKeys.set(body, key);
  }
  return key;
}

// A body that cannot be shown stays inside its own area, so the form, the panel and History keep working.
class BodyBoundary extends Component<
  { testId: string; children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: errorText(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Could not show the body', error, info.componentStack);
  }

  render() {
    return this.state.error === null ? (
      this.props.children
    ) : (
      <p data-testid={`${this.props.testId}-error`} className="error">
        Could not show the body: {this.state.error}
      </p>
    );
  }
}

type View = 'pretty' | 'raw';

// Memoized: the status poll re-renders the app every 2 s, and this can hold 1 MiB.
function InlineBodyText({
  testId,
  bytes,
  kind,
}: {
  testId: string;
  bytes: Uint8Array;
  kind: BodyKind;
}) {
  // Pretty is the default for each body shown; a choice made on one body does not carry to the next.
  const [choice, setChoice] = useState({ bytes, view: 'pretty' as View });
  const view = choice.bytes === bytes ? choice.view : 'pretty';
  const setView = (next: View) => setChoice({ bytes, view: next });
  const text = useMemo(() => textDecoder().decode(bytes), [bytes]);
  const shown = useMemo(() => {
    if (kind === 'raw' || view === 'raw') return text;
    const formatter = createFormatter(kind);
    return formatter.push(text) + formatter.end();
  }, [text, kind, view]);
  return (
    <div>
      <BodyViewLabel
        testId={testId}
        kind={kind}
        view={view}
        bom={text.startsWith('﻿')}
        onChange={setView}
      />
      <MonacoBody
        testId={testId}
        text={shown}
        language={languageOf(kind)}
        loadedChars={text.length}
      />
    </div>
  );
}

const languageOf = (kind: BodyKind) => (kind === 'raw' ? 'plaintext' : kind);

// Monaco takes a leading byte order mark out of the text it draws (plan.md), so the label says it is there.
const BOM_NOTE =
  'The recorded text starts with a byte order mark (U+FEFF), which is not drawn.';

// Pretty is a display of the recorded text; Raw is the recorded text itself. A raw-kind body has no switch, and
// shows the byte order mark note on its own when it has one.
function BodyViewLabel({
  testId,
  kind,
  view,
  bom,
  onChange,
}: {
  testId: string;
  kind: BodyKind;
  view: View;
  bom: boolean;
  onChange: (view: View) => void;
}) {
  if (kind === 'raw') {
    return bom ? (
      <p data-testid={`${testId}-view`} data-view="raw">
        {BOM_NOTE}
      </p>
    ) : null;
  }
  return (
    <div className="row body-view">
      <span data-testid={`${testId}-view`} data-view={view}>
        {view === 'pretty'
          ? 'Pretty-printed for reading; Raw shows the recorded text.'
          : 'Raw: the recorded text.'}
        {bom ? ` ${BOM_NOTE}` : null}
      </span>
      <button
        type="button"
        aria-pressed={view === 'pretty'}
        onClick={() => onChange('pretty')}
      >
        Pretty
      </button>
      <button
        type="button"
        aria-pressed={view === 'raw'}
        onClick={() => onChange('raw')}
      >
        Raw
      </button>
    </div>
  );
}

// Read-only Monaco: links off, so nothing in a body opens a page; lines wrap, because Monaco stops drawing a
// long line at "Show more" and a minified body is one line (spike-monaco.md). The editor scrolls inside a
// fixed-height area, so a long body does not push History down the page. `onCreate` runs for each editor
// created, including StrictMode's second mount, so a caller can give it a model.
function useBodyEditor(
  host: React.RefObject<HTMLDivElement | null>,
  onCreate: (editor: monaco.editor.IStandaloneCodeEditor) => void = () => {},
) {
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const created = useRef(onCreate);
  created.current = onCreate;
  useEffect(() => {
    const instance = monaco.editor.create(host.current as HTMLDivElement, {
      theme: definePigeonTheme(),
      fontFamily:
        "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12,
      model: null,
      readOnly: true,
      links: false,
      wordWrap: 'on',
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
    });
    editor.current = instance;
    created.current(instance);
    return () => {
      instance.getModel()?.dispose();
      instance.dispose();
      editor.current = null;
    };
  }, [host]);
  return editor;
}

// Replaces the editor's model, disposing the old one.
function setModel(
  editor: monaco.editor.IStandaloneCodeEditor,
  text: string,
  language: string,
) {
  const previous = editor.getModel();
  editor.setModel(monaco.editor.createModel(text, language));
  previous?.dispose();
}

// The editor in the design's colours (slice 6): surface background, muted gutter, accent-tinted strings.
let pigeonThemeDefined = false;
function definePigeonTheme(): string {
  if (!pigeonThemeDefined) {
    monaco.editor.defineTheme('pigeon', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'string', foreground: 'E3C27A' },
        { token: 'string.key.json', foreground: '60A5FA' },
        { token: 'string.value.json', foreground: '3DD6B5' },
        { token: 'number', foreground: 'E7E9EC' },
        { token: 'keyword', foreground: 'A78BFA' },
        { token: 'tag', foreground: '60A5FA' },
        { token: 'attribute.name', foreground: 'A78BFA' },
      ],
      colors: {
        'editor.background': '#13161B',
        'editor.foreground': '#E7E9EC',
        'editorLineNumber.foreground': '#5B626D',
        'editorLineNumber.activeForeground': '#8B929D',
        'editor.lineHighlightBackground': '#1A1E25',
        'editor.selectionBackground': '#3DD6B533',
        'editorWidget.background': '#1A1E25',
      },
    });
    pigeonThemeDefined = true;
  }
  return 'pigeon';
}

function MonacoBody({
  testId,
  text,
  language,
  loadedChars,
}: {
  testId: string;
  text: string;
  language: string;
  loadedChars: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  // The model is set by the effect below, which runs after the editor's own effect on every mount, StrictMode's
  // second one included; setting it in onCreate as well built every model twice (code review, finding 6).
  const editor = useBodyEditor(host);

  useEffect(() => {
    if (editor.current) setModel(editor.current, text, language);
  }, [editor, text, language]);

  return (
    <div
      ref={host}
      className="body-editor"
      data-testid={testId}
      data-loaded-chars={loadedChars}
    />
  );
}

// Appends text at the end of the model as an edit: pages are never joined into one string, which would meet V8's
// limit of 536,870,888 characters (plan.md).
function appendToModel(model: monaco.editor.ITextModel, text: string) {
  if (text === '') return;
  const line = model.getLineCount();
  const column = model.getLineMaxColumn(line);
  model.applyEdits([
    { range: new monaco.Range(line, column, line, column), text },
  ]);
}

function PagedBodyText({
  testId,
  file,
  kind,
}: {
  testId: string;
  file: StoredFile;
  kind: BodyKind;
}) {
  // Decoded pages, kept so a switch between Pretty and Raw can rebuild the model from them.
  const pages = useRef<string[]>([]);
  const [loadedChars, setLoadedChars] = useState(0);
  const [bom, setBom] = useState(false);
  const [view, setViewState] = useState<View>('pretty');
  const viewRef = useRef<View>('pretty');
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [loaded, setLoaded] = useState(0);
  // Refs, not state: a double click happens before the next render.
  const busy = useRef(false);
  const shown = useRef(true);
  const offset = useRef(0);
  // Streaming, so a character split across two pages decodes correctly.
  const decoder = useRef(textDecoder());
  // The formatter for the model being shown; it carries its state from one page to the next.
  const formatter = useRef<BodyFormatter | null>(null);
  // A page ending in CR is held back by that CR until the next page: appended as two edits, a CR and the LF that
  // follows it would show as two line breaks.
  const heldCR = useRef('');
  const host = useRef<HTMLDivElement>(null);

  const complete = () => offset.current >= file.length;
  const formatterFor = (shownView: View) =>
    kind === 'raw' || shownView === 'raw' ? null : createFormatter(kind);
  const shownText = (page: string, last: boolean) => {
    const current = formatter.current;
    const text =
      heldCR.current +
      (current ? current.push(page) + (last ? current.end() : '') : page);
    heldCR.current = !last && text.endsWith('\r') ? '\r' : '';
    return heldCR.current ? text.slice(0, -1) : text;
  };

  // A new model, with every page loaded so far appended through a new formatter.
  const rebuild = (
    target: monaco.editor.IStandaloneCodeEditor,
    shownView: View,
  ) => {
    setModel(target, '', languageOf(kind));
    formatter.current = formatterFor(shownView);
    heldCR.current = '';
    const model = target.getModel() as monaco.editor.ITextModel;
    pages.current.forEach((page, index) => {
      appendToModel(
        model,
        shownText(page, complete() && index === pages.current.length - 1),
      );
    });
  };

  const editor = useBodyEditor(host, (created) =>
    rebuild(created, viewRef.current),
  );

  // A click handler: an error here reaches no error boundary, so it is shown in the body area like a failed read
  // (code review, finding 2).
  const setView = (next: View) => {
    viewRef.current = next;
    setViewState(next);
    if (!editor.current) return;
    try {
      rebuild(editor.current, next);
      setError(null);
    } catch (caught) {
      setError(`Could not show the body: ${errorText(caught)}`);
    }
  };

  const readNext = useCallback(async () => {
    if (busy.current || offset.current >= file.length) return;
    busy.current = true;
    setReading(true);
    setError(null);
    let failure: string | null = null;
    try {
      const got = await pigeon.readBody({
        fileId: file.fileId,
        offset: offset.current,
        length: BODY_PAGE_BYTES,
      });
      if (!shown.current) return;
      if (!got.ok) {
        failure = got.message;
      } else if (got.bytes.length === 0) {
        failure = 'The stored body ended before its recorded length';
      } else {
        offset.current += got.bytes.length;
        const last = offset.current >= file.length;
        const text = decoder.current.decode(got.bytes, { stream: !last });
        if (pages.current.length === 0 && text.startsWith('﻿')) setBom(true);
        pages.current.push(text);
        // Inside the try: an edit that throws is reported like a failed read.
        const model = editor.current?.getModel();
        if (model) appendToModel(model, shownText(text, last));
        setLoadedChars((count) => count + text.length);
        setLoaded(offset.current);
      }
    } catch (caught) {
      failure = errorText(caught);
    } finally {
      busy.current = false;
    }
    if (!shown.current) return;
    setReading(false);
    setError(failure === null ? null : `Could not read the body: ${failure}`);
  }, [file.fileId, file.length]);

  useEffect(() => {
    shown.current = true;
    void readNext();
    return () => {
      shown.current = false;
    };
  }, [readNext]);

  const remaining = file.length - loaded;
  return (
    <div>
      <BodyViewLabel
        testId={testId}
        kind={kind}
        view={view}
        bom={bom}
        onChange={setView}
      />
      <div
        ref={host}
        className="body-editor"
        data-testid={testId}
        data-loaded-chars={loadedChars}
      />
      {error ? (
        <p data-testid={`${testId}-error`} className="error">
          {error}
        </p>
      ) : null}
      {remaining > 0 ? (
        <p>
          <span data-testid={`${testId}-remaining`} data-remaining={remaining}>
            {remaining.toLocaleString()} of {file.length.toLocaleString()} bytes
            not loaded
          </span>{' '}
          <button
            type="button"
            disabled={reading}
            onClick={() => void readNext()}
          >
            Load more
          </button>
        </p>
      ) : null}
    </div>
  );
}

// A row per call, as the design's History Row: method badge, path with host and time, status with duration. Rows group
// under the day they were sent. The visible text is split up, so the row's accessible name keeps the whole call.
function HistoryList({
  calls,
  error,
  onOpen,
  onDelete,
}: {
  calls: CallView[];
  error: string | null;
  onOpen: (sendId: string) => void;
  onDelete: (sendId: string) => void;
}) {
  // One group per day, in the order days first appear; today is computed once per render (code review of
  // workspace-shell, 5 and 9).
  const today = startOfDay(new Date());
  const groups = new Map<string, CallView[]>();
  for (const call of calls) {
    const day =
      call.state === 'unreadable'
        ? 'Unreadable'
        : dayLabel(call.send.sentAt, today);
    groups.set(day, [...(groups.get(day) ?? []), call]);
  }
  return (
    <section className="history">
      <div className="title-row">
        <h2>History</h2>
        <span className="count">{calls.length} calls</span>
      </div>
      {error ? (
        <p data-testid="history-error" className="error">
          History could not be loaded: {error}
        </p>
      ) : null}
      <ol data-testid="history" className="history-list">
        {[...groups].map(([day, dayCalls]) => [
          <li key={`day-${day}`} className="day" aria-hidden="true">
            {day}
          </li>,
          ...dayCalls.map((call) =>
            call.state === 'unreadable' ? (
              <li key={call.id} data-state="unreadable">
                Unreadable record {call.id}: {call.error}
              </li>
            ) : (
              <li key={call.send._id} data-state={call.state}>
                <button
                  type="button"
                  className="history-row"
                  aria-label={`${call.send.request.method} ${call.send.request.url} — ${outcome(call)} · ${call.send.sentAt.toLocaleString()}`}
                  onClick={() => onOpen(call.send._id)}
                >
                  <MethodBadge method={call.send.request.method} />
                  <span className="row-info">
                    <span className="path">
                      {pathOf(call.send.request.url)}
                    </span>
                    <span className="meta">
                      {hostOf(call.send.request.url)} ·{' '}
                      {call.send.sentAt.toLocaleTimeString()}
                    </span>
                  </span>
                  <span className="result">
                    <span className={`code ${outcomeClass(call)}`}>
                      {codeText(call)}
                    </span>
                    <span className="duration">{durationText(call)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="row-delete"
                  aria-label={`Delete ${call.send.request.method} ${call.send.request.url}`}
                  onClick={() => onDelete(call.send._id)}
                >
                  ×
                </button>
              </li>
            ),
          ),
        ])}
      </ol>
    </section>
  );
}

type ReadableCall = Exclude<CallView, { state: 'unreadable' }>;

function MethodBadge({ method }: { method: string }) {
  return (
    <span className={`method-badge method-${method.toLowerCase()}`}>
      {method}
    </span>
  );
}

const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

const dayLabel = (date: Date, today: number) => {
  const days = Math.round((today - startOfDay(date)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString();
};

const parsedUrl = (url: string) => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};
const pathOf = (url: string) => {
  const u = parsedUrl(url);
  return u ? `${u.pathname}${u.search}` : url;
};
const hostOf = (url: string) => parsedUrl(url)?.host ?? '';

function codeText(call: ReadableCall): string {
  if (call.state === 'in-flight') return '…';
  if (call.state === 'interrupted' || !call.completion) return '—';
  return 'error' in call.completion
    ? 'ERR'
    : String(call.completion.response.status);
}

function outcomeClass(call: ReadableCall): string {
  if (call.state !== 'completed' || !call.completion) return 'faint';
  if ('error' in call.completion) return 'err';
  return statusClass(call.completion.response.status);
}

const durationText = (call: ReadableCall) => {
  if (call.state === 'in-flight') return 'in flight';
  if (call.state === 'interrupted' || !call.completion) return 'interrupted';
  const ms = call.completion.durationMs;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
};

function outcome(call: Exclude<CallView, { state: 'unreadable' }>): string {
  if (call.state === 'in-flight') return 'in flight';
  if (call.state === 'interrupted' || !call.completion) return 'interrupted';
  return 'error' in call.completion
    ? call.completion.error.code
    : String(call.completion.response.status);
}
