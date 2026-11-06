// Renderer: request form, response view, history list, database status.
// Request and response bodies are untrusted input: rendered as text only, never as HTML (AGENTS.md).
import {
  Fragment,
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
      {body ? <BodyText testId="call-request-body" body={body} /> : null}
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
      <BodyText testId="response-body" body={body} />
    </div>
  );
}

// A body in its document is shown whole; one in a file is shown a page at a time.
function BodyText({ testId, body }: { testId: string; body: StoredBody }) {
  return 'fileId' in body ? (
    // One instance per file: an answer for a body no longer shown reaches an unmounted instance.
    <PagedBodyText key={body.fileId} testId={testId} file={body} />
  ) : (
    <InlineBodyText testId={testId} bytes={body} />
  );
}

// Memoized: the status poll re-renders the app every 2 s, and this can hold 1 MiB.
function InlineBodyText({
  testId,
  bytes,
}: {
  testId: string;
  bytes: Uint8Array;
}) {
  const text = useMemo(() => textDecoder().decode(bytes), [bytes]);
  return <pre data-testid={testId}>{text}</pre>;
}

function PagedBodyText({ testId, file }: { testId: string; file: StoredFile }) {
  // One text node per page: one string would meet V8's limit of 536,870,888 characters (plan.md).
  const [pages, setPages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [loaded, setLoaded] = useState(0);
  // Refs, not state: a double click happens before the next render.
  const busy = useRef(false);
  const shown = useRef(true);
  const offset = useRef(0);
  // Streaming, so a character split across two pages decodes correctly.
  const decoder = useRef(textDecoder());

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
        const text = decoder.current.decode(got.bytes, {
          stream: offset.current < file.length,
        });
        setPages((current) => [...current, text]);
        setLoaded(offset.current);
      }
    } catch (caught) {
      failure = errorText(caught);
    } finally {
      busy.current = false;
    }
    if (!shown.current) return;
    setReading(false);
    setError(failure);
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
      <pre data-testid={testId}>
        {pages.map((page, index) => (
          <Fragment key={index}>{page}</Fragment>
        ))}
      </pre>
      {error ? (
        <p data-testid={`${testId}-error`} className="error">
          Could not read the body: {error}
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
