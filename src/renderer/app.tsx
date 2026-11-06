// Renderer: request form, response view, history list, database status.
// Response bodies are untrusted input: rendered as text only, never as HTML (AGENTS.md).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CompletionDoc } from '../core/call-schema';
import { toCurl } from '../core/curl';
import { formFromCall } from '../core/form-from-call';
import { type WireRequest, buildWireRequest } from '../core/wire';
import {
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
const errorText = (error: unknown) =>
  String((error as Error)?.message ?? error);

// Builds the command and tries the clipboard; the command stays selectable if the clipboard fails.
async function exportCurl(request: () => WireRequest): Promise<CurlOutcome> {
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
const decoder = new TextDecoder('utf-8', { fatal: false });

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
              window.pigeon.send({
                clientRequestId,
                ...form,
                queryRows: nonEmpty(form.queryRows),
                headerRows: nonEmpty(form.headerRows),
              }),
            )
          }
          onCancel={() => inFlightId && window.pigeon.cancel(inFlightId)}
          onCopyCurl={async () =>
            setFormCurl(
              await exportCurl(() =>
                buildWireRequest({
                  ...form,
                  queryRows: nonEmpty(form.queryRows),
                  headerRows: nonEmpty(form.headerRows),
                }),
              ),
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
              const loaded = formFromCall(opened.send.request);
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
  onReplay,
  onEdit,
  onCopyCurl,
}: {
  call: Opened;
  canReplay: boolean;
  curl: CurlOutcome | null;
  onReplay: () => void;
  onEdit: () => void;
  onCopyCurl: () => void;
}) {
  const { method, url, headers } = call.send.request;
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
      <CurlView testId="call-curl" outcome={curl} />
      <p data-testid="call-state">{stateText(call.state)}</p>
      <h3>Request as sent</h3>
      <p data-testid="call-request-line">
        {method} {url} · sent {call.send.sentAt.toLocaleString()}
      </p>
      <pre data-testid="call-request-headers">
        {headers.map(([n, v]) => `${n}: ${v}`).join('\n')}
      </pre>
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
      <pre data-testid="response-body">{decoder.decode(body)}</pre>
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
