// Renderer: request form, response view, history list, database status.
// Response bodies are untrusted input: rendered as text only, never as HTML (AGENTS.md).
import { useCallback, useEffect, useState } from 'react';
import type { CompletionDoc } from '../core/call-schema';
import {
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

const STATUS_POLL_MS = 2000;
const HISTORY_POLL_MS = 500;
const decoder = new TextDecoder('utf-8', { fatal: false });

export function App() {
  const [status, setStatus] = useState<DbStatusView | null>(null);
  const [history, setHistory] = useState<CallView[]>([]);
  const [result, setResult] = useState<SendResult | null>(null);
  const [inFlightId, setInFlightId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

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

  const send = async (input: Omit<SendInput, 'clientRequestId'>) => {
    const clientRequestId = crypto.randomUUID();
    setInFlightId(clientRequestId);
    setResult(null);
    try {
      setResult(await window.pigeon.send({ clientRequestId, ...input }));
    } catch (error) {
      // A rejected invoke is shown, not swallowed (review #2).
      setResult({
        ok: false,
        error: {
          kind: 'unexpected',
          message: String((error as Error)?.message ?? error),
        },
      });
    } finally {
      setInFlightId(null);
      await refreshHistory();
    }
  };

  return (
    <main>
      <h1>DigitalPigeon</h1>
      <StatusBar status={status} />
      <RequestForm
        canSend={status?.status === 'up'}
        inFlight={inFlightId !== null}
        onSend={send}
        onCancel={() => inFlightId && window.pigeon.cancel(inFlightId)}
      />
      <ResultView result={result} />
      <HistoryList calls={history} error={historyError} />
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
  canSend,
  inFlight,
  onSend,
  onCancel,
}: {
  canSend: boolean;
  inFlight: boolean;
  onSend: (input: Omit<SendInput, 'clientRequestId'>) => void;
  onCancel: () => void;
}) {
  const [method, setMethod] = useState<Method>('GET');
  const [url, setUrl] = useState('');
  const [queryRows, setQueryRows] = useState<Row[]>([]);
  const [headerRows, setHeaderRows] = useState<Row[]>([]);
  const nonEmpty = (rows: Row[]) => rows.filter(([name]) => name.trim() !== '');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!inFlight)
          onSend({
            method,
            url,
            queryRows: nonEmpty(queryRows),
            headerRows: nonEmpty(headerRows),
          });
      }}
    >
      <div className="row">
        <select
          aria-label="Method"
          value={method}
          onChange={(e) => setMethod(e.target.value as Method)}
        >
          {METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input
          aria-label="URL"
          className="url"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
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
      </div>
      <RowsEditor label="Query" rows={queryRows} onChange={setQueryRows} />
      <RowsEditor label="Header" rows={headerRows} onChange={setHeaderRows} />
    </form>
  );
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
}: {
  calls: CallView[];
  error: string | null;
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
              <span className="method">{call.send.request.method}</span>{' '}
              {call.send.request.url} — {outcome(call)} ·{' '}
              {call.send.sentAt.toLocaleString()}
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
