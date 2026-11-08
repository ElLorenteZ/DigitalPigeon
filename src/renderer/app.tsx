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
import { formFromCall } from '../core/form-from-call';
import { type BodyInput, buildWireRequest } from '../core/wire';
import {
  BODY_PAGE_BYTES,
  type CallDetail,
  type CallView,
  type DbStatusView,
  METHODS,
  type PigeonApi,
  type SendInput,
  type SendResult,
} from '../shared/ipc-contract';

declare global {
  interface Window {
    pigeon: PigeonApi;
  }
}

// Monaco's workers load as bundled files from the app's own file:// origin, which script-src 'self' admits.
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
type Form = Omit<SendInput, 'clientRequestId' | 'method'> & { method: Method };
type Opened = Exclude<CallDetail, { state: 'unreadable' }>;
type CurlOutcome = { command: string; copied: boolean } | { error: string };

const EMPTY_FORM: Form = {
  method: 'GET',
  url: '',
  queryRows: [],
  headerRows: [],
};
const nonEmpty = (rows: Row[]) => rows.filter(([name]) => name.trim() !== '');
// Nameless rows are ignored, as the form has always done for query and header rows.
const requestOf = (form: Form) => ({
  ...form,
  queryRows: nonEmpty(form.queryRows),
  headerRows: nonEmpty(form.headerRows),
  ...(form.body?.type === 'form'
    ? { body: { type: 'form' as const, rows: nonEmpty(form.body.rows) } }
    : {}),
});
const errorText = (error: unknown) =>
  String((error as Error)?.message ?? error);

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
const HISTORY_POLL_MS = 500;
// ignoreBOM keeps a byte order mark on screen: dropping one would hide bytes the record holds.
const textDecoder = () => new TextDecoder('utf-8', { ignoreBOM: true });

export function App() {
  const [status, setStatus] = useState<DbStatusView | null>(null);
  const [history, setHistory] = useState<CallView[]>([]);
  const [result, setResult] = useState<SendResult | null>(null);
  const [inFlightId, setInFlightId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [formCurl, setFormCurl] = useState<CurlOutcome | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [openedCurl, setOpenedCurl] = useState<CurlOutcome | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // Never rejects: a failure is shown above the list (review #3).
  const refreshHistory = useCallback(async () => {
    try {
      const listed = await window.pigeon.listCalls();
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
      const next = await window.pigeon.dbStatus();
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

  // The latest click decides what is open, whichever answer arrives last.
  const latestOpen = useRef(0);
  const openCall = async (sendId: string) => {
    const thisOpen = ++latestOpen.current;
    setOpenedCurl(null);
    setEditError(null);
    setOpenError(null);
    try {
      const got = await window.pigeon.getCall(sendId);
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
  const showRequest = () =>
    requestRegion.current?.scrollIntoView({ block: 'start' });
  const resultRegion = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (result) resultRegion.current?.scrollIntoView({ block: 'nearest' });
  }, [result]);

  const canSend = status?.status === 'up';
  const inFlight = inFlightId !== null;

  return (
    <main>
      <h1>DigitalPigeon</h1>
      <StatusBar status={status} />
      <div ref={requestRegion}>
        <RequestForm
          form={form}
          onChange={setForm}
          canSend={canSend}
          inFlight={inFlight}
          onSend={() =>
            run((clientRequestId) =>
              window.pigeon.send({ clientRequestId, ...requestOf(form) }),
            )
          }
          onCancel={() => inFlightId && window.pigeon.cancel(inFlightId)}
          onCopyCurl={async () =>
            setFormCurl(
              await exportCurl(() => buildWireRequest(requestOf(form))),
            )
          }
        />
      </div>
      <CurlView testId="form-curl" outcome={formCurl} />
      <div ref={resultRegion}>
        <ResultView result={result} />
      </div>
      <HistoryList
        calls={history}
        error={historyError}
        onOpen={(sendId) => void openCall(sendId)}
      />
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
            onReplay={() => {
              showRequest();
              void run((clientRequestId) =>
                window.pigeon.replay({
                  clientRequestId,
                  sendId: opened.send._id,
                }),
              );
            }}
            onEdit={() => {
              let loaded: ReturnType<typeof formFromCall>;
              try {
                loaded = formFromCall(opened.send.request);
              } catch (error) {
                setEditError(errorText(error));
                return;
              }
              setEditError(null);
              setForm({ ...loaded, method: loaded.method as Method });
              setFormCurl(null);
              showRequest();
            }}
            onCopyCurl={async () =>
              setOpenedCurl(await exportCurl(() => opened.send.request))
            }
          />
        ) : null}
      </div>
    </main>
  );
}

function StatusBar({ status }: { status: DbStatusView | null }) {
  if (!status) return <p data-testid="db-status">Database: checking…</p>;
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
] as const;

// JSON, XML and Text share one text box, so changing between them keeps what was typed.
function bodyOfType(type: BodyInput['type'], current: BodyInput): BodyInput {
  if (type === 'none') return { type };
  if (type === 'form') {
    return current.type === 'form' ? current : { type, rows: [] };
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
    <fieldset>
      <legend>Body</legend>
      <select
        aria-label="Body type"
        value={body.type}
        onChange={(e) =>
          onChange(bodyOfType(e.target.value as BodyInput['type'], body))
        }
      >
        {BODY_TYPES.map(([type, label]) => (
          <option key={type} value={type}>
            {label}
          </option>
        ))}
      </select>
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
    </fieldset>
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
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!inFlight) onSend();
      }}
    >
      <div className="row">
        <select
          aria-label="Method"
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
          placeholder="https://…"
          value={form.url}
          onChange={(e) => onChange({ ...form, url: e.target.value })}
        />
        {inFlight ? (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <button type="submit" disabled={!canSend}>
            Send
          </button>
        )}
        <button type="button" onClick={onCopyCurl}>
          Copy as curl
        </button>
      </div>
      <RowsEditor
        label="Query"
        rows={form.queryRows}
        onChange={(queryRows) => onChange({ ...form, queryRows })}
      />
      <RowsEditor
        label="Header"
        rows={form.headerRows}
        onChange={(headerRows) => onChange({ ...form, headerRows })}
      />
      <BodyEditor
        body={form.body ?? { type: 'none' }}
        onChange={(body) => onChange({ ...form, body })}
      />
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
function CallPanel({
  call,
  canReplay,
  curl,
  editError,
  onReplay,
  onEdit,
  onCopyCurl,
}: {
  call: Opened;
  canReplay: boolean;
  curl: CurlOutcome | null;
  editError: string | null;
  onReplay: () => void;
  onEdit: () => void;
  onCopyCurl: () => void;
}) {
  const { method, url, headers, body } = call.send.request;
  return (
    <section data-testid="call-panel" data-state={call.state}>
      <h2>Call</h2>
      <div className="row">
        <button type="button" onClick={onReplay} disabled={!canReplay}>
          Replay
        </button>
        <button type="button" onClick={onEdit}>
          Edit
        </button>
        <button type="button" onClick={onCopyCurl}>
          Copy call as curl
        </button>
      </div>
      {editError ? (
        <p data-testid="call-edit-error" className="error">
          Cannot edit this call: {editError}
        </p>
      ) : null}
      <CurlView testId="call-curl" outcome={curl} />
      <p data-testid="call-state">{stateText(call.state)}</p>
      <h3>Request as sent</h3>
      <p data-testid="call-request-line">
        {method} {url} · sent {call.send.sentAt.toLocaleString()}
      </p>
      <pre data-testid="call-request-headers">
        {headers.map(([n, v]) => `${n}: ${v}`).join('\n')}
      </pre>
      {body ? (
        <BodyText testId="call-request-body" body={body} headers={headers} />
      ) : null}
      {call.completion ? (
        <>
          <h3>Response</h3>
          <p data-testid="call-completed-at">
            completed {call.completion.completedAt.toLocaleString()}
          </p>
          <CompletionView completion={call.completion} />
        </>
      ) : null}
    </section>
  );
}

function stateText(state: Opened['state']): string {
  if (state === 'in-flight') return 'In flight';
  if (state === 'interrupted') return 'Interrupted: no response was recorded';
  return 'Completed';
}

function ResultView({ result }: { result: SendResult | null }) {
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
          <CompletionView completion={result.completion} />
        ) : null}
      </section>
    );
  }
  return (
    <section data-testid="result">
      <CompletionView completion={result.completion} />
    </section>
  );
}

function CompletionView({ completion }: { completion: CompletionDoc }) {
  const duration = `${Math.round(completion.durationMs)} ms`;
  if ('error' in completion) {
    return (
      <p data-testid="response-error">
        {completion.error.code}: {completion.error.message} ({duration})
      </p>
    );
  }
  const { status, headers, body } = completion.response;
  return (
    <div>
      <p data-testid="response-status">
        {status} · {duration}
      </p>
      <pre data-testid="response-headers">
        {headers.map(([n, v]) => `${n}: ${v}`).join('\n')}
      </pre>
      <BodyText testId="response-body" body={body} headers={headers} />
    </div>
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
      const got = await window.pigeon.readBody({
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

function HistoryList({
  calls,
  error,
  onOpen,
}: {
  calls: CallView[];
  error: string | null;
  onOpen: (sendId: string) => void;
}) {
  return (
    <section>
      <h2>History</h2>
      {error ? (
        <p data-testid="history-error" className="error">
          History could not be loaded: {error}
        </p>
      ) : null}
      <ol data-testid="history">
        {calls.map((call) =>
          call.state === 'unreadable' ? (
            <li key={call.id} data-state="unreadable">
              Unreadable record {call.id}: {call.error}
            </li>
          ) : (
            <li key={call.send._id} data-state={call.state}>
              <button
                type="button"
                className="history-row"
                onClick={() => onOpen(call.send._id)}
              >
                <span className="method">{call.send.request.method}</span>{' '}
                {call.send.request.url} — {outcome(call)} ·{' '}
                {call.send.sentAt.toLocaleString()}
              </button>
            </li>
          ),
        )}
      </ol>
    </section>
  );
}

function outcome(call: Exclude<CallView, { state: 'unreadable' }>): string {
  if (call.state === 'in-flight') return 'in flight';
  if (call.state === 'interrupted' || !call.completion) return 'interrupted';
  return 'error' in call.completion
    ? call.completion.error.code
    : String(call.completion.response.status);
}
