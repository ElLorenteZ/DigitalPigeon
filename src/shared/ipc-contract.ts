// The IPC contract between renderer and main (test-strategy.md T2.1: the compiler checks both sides
// against these types; main validates every message with these schemas at runtime).
// Bodies are Uint8Array: the sandboxed renderer has no Node Buffer.
import { z } from 'zod';
import {
  CompletionDocSchema,
  CompletionSummarySchema,
  EnvironmentSnapshotSchema,
  SendDocSchema,
  SendSummarySchema,
} from '../core/call-schema';

export const channels = {
  send: 'pigeon:send',
  cancel: 'pigeon:cancel',
  listCalls: 'pigeon:list-calls',
  listResponses: 'pigeon:list-responses',
  listRequestGroups: 'pigeon:list-request-groups',
  listStatusCodes: 'pigeon:list-status-codes',
  deleteCall: 'pigeon:delete-call',
  searchCalls: 'pigeon:search-calls',
  importOpenApi: 'pigeon:import-openapi',
  importWsdl: 'pigeon:import-wsdl',
  listTemplates: 'pigeon:list-templates',
  getTemplate: 'pigeon:get-template',
  dbStatus: 'pigeon:db-status',
  getCall: 'pigeon:get-call',
  replay: 'pigeon:replay',
  readBody: 'pigeon:read-body',
  describeBody: 'pigeon:describe-body',
  listEnvironments: 'pigeon:list-environments',
  saveEnvironment: 'pigeon:save-environment',
  deleteEnvironment: 'pigeon:delete-environment',
  setActiveEnvironment: 'pigeon:set-active-environment',
  listSavedRequests: 'pigeon:list-saved-requests',
  getSavedRequest: 'pigeon:get-saved-request',
  saveSavedRequest: 'pigeon:save-saved-request',
  deleteSavedRequest: 'pigeon:delete-saved-request',
} as const;

export const METHODS = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
] as const;

const RowsSchema = z.array(z.tuple([z.string(), z.string()]));

const BodyInputSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('none') }),
  z.strictObject({
    type: z.enum(['json', 'xml', 'text']),
    text: z.string(),
  }),
  z.strictObject({ type: z.literal('form'), rows: RowsSchema }),
  z.strictObject({
    type: z.literal('multipart'),
    parts: z.array(
      z.discriminatedUnion('kind', [
        z.strictObject({
          kind: z.literal('field'),
          name: z.string(),
          value: z.string(),
        }),
        z.strictObject({
          kind: z.literal('file'),
          name: z.string(),
          filename: z.string(),
          contentType: z.string(),
          // Arrives in main as a plain Uint8Array, not a Buffer (spike-file-input-ipc.md).
          bytes: z.instanceof(Uint8Array),
        }),
      ]),
    ),
    boundary: z.string().optional(),
  }),
]);

/** What the form holds: sent, or saved as a saved request (slice 5). */
export const RequestFormSchema = z.strictObject({
  method: z.enum(METHODS),
  // A full http(s) URL, or a path joined to the chosen environment's baseUrl in main (slice 5).
  url: z.union([
    z.url({ protocol: /^https?$/ }),
    z.string().regex(/^\//, 'A path starts with /'),
  ]),
  queryRows: RowsSchema,
  headerRows: RowsSchema,
  body: BodyInputSchema.optional(),
});
export type RequestForm = z.infer<typeof RequestFormSchema>;

export const SendInputSchema = z.strictObject({
  clientRequestId: z.string().min(1),
  ...RequestFormSchema.shape,
  /** The environment the select shows; main loads it by id (plan revision 2, B1). */
  environmentId: z.string().min(1).nullable().optional(),
  /** The saved request the form came from; recorded only if it still exists (review R2). */
  savedRequestId: z.string().min(1).optional(),
});
export type SendInput = z.infer<typeof SendInputSchema>;

export const CancelInputSchema = z.strictObject({
  clientRequestId: z.string().min(1),
});

export const ReplayInputSchema = z.strictObject({
  clientRequestId: z.string().min(1),
  sendId: z.string().min(1),
});
export type ReplayInput = z.infer<typeof ReplayInputSchema>;

export const GetCallInputSchema = z.string().min(1);

/**
 * The responses to one request: same method and URL path; query, fragment and host are not part of the key (slice 7).
 * `auth` narrows them to the calls sent with that Authorization, otherwise Cookie, value; `''` means none; absent means
 * every auth (history-grouping). Bounded like a search's auth values.
 */
/**
 * A status selection (history-status-filter): three-digit codes, and `''` for calls with no response. Empty or absent
 * selects every call.
 */
const StatusList = z
  .array(z.string().regex(/^(\d{3})?$/))
  .max(100)
  .optional();

/**
 * History for one environment, or every call with no input (environment-aware-history); with `statuses`, only the calls
 * answered with one of them (history-status-filter).
 */
export const ListCallsInputSchema = z
  .strictObject({
    environmentId: z.string().min(1).optional(),
    statuses: StatusList,
  })
  .optional();
export type ListCallsInput = z.infer<typeof ListCallsInputSchema>;

export const ListResponsesInputSchema = z.strictObject({
  method: z.enum(METHODS),
  path: z.string().startsWith('/').max(8192),
  auth: z.string().max(65536).optional(),
  /** Only calls recorded under this environment; absent for every call (environment-aware-history). */
  environmentId: z.string().min(1).optional(),
  /** Only calls answered with one of these; an expanded History group passes the History status filter. The strips
   * never do (history-status-filter, code review 3). */
  statuses: StatusList,
});
export type ListResponsesInput = z.infer<typeof ListResponsesInputSchema>;

/** The most one readBody call returns: the display page, equal to the inline limit (plan.md). */
export const BODY_PAGE_BYTES = 1024 * 1024;

export const ReadBodyInputSchema = z.strictObject({
  fileId: z.string().min(1),
  offset: z.number().int().nonnegative(),
  length: z.number().int().positive().max(BODY_PAGE_BYTES),
});
export type ReadBodyInput = z.infer<typeof ReadBodyInputSchema>;

export const ReadBodyResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), bytes: z.instanceof(Uint8Array) }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type ReadBodyResult = z.infer<typeof ReadBodyResultSchema>;

// The same shape main records in a call's snapshot (second code review, 9).
export const EnvironmentSchema = EnvironmentSnapshotSchema;
export type EnvironmentView = z.infer<typeof EnvironmentSchema>;

export const ListEnvironmentsResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    environments: z.array(EnvironmentSchema),
    activeId: z.string().nullable(),
  }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type ListEnvironmentsResult = z.infer<
  typeof ListEnvironmentsResultSchema
>;

/** Without an id, a new environment; with one, that environment saved over. */
export const SaveEnvironmentInputSchema = z.strictObject({
  id: z.string().min(1).optional(),
  name: z.string(),
  baseUrl: z.string(),
});
export type SaveEnvironmentInput = z.infer<typeof SaveEnvironmentInputSchema>;

/** For a save, a delete or a choice that returns nothing else: done, or why not. */
export const MutationResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type MutationResult = z.infer<typeof MutationResultSchema>;

export const IdSchema = z.string().min(1);
export const ActiveEnvironmentInputSchema = z.string().min(1).nullable();

export const SavedRequestListingSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  method: z.string(),
  url: z.string(),
});
export type SavedRequestListing = z.infer<typeof SavedRequestListingSchema>;

export const ListSavedRequestsResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    savedRequests: z.array(SavedRequestListingSchema),
  }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type ListSavedRequestsResult = z.infer<
  typeof ListSavedRequestsResultSchema
>;

export const GetSavedRequestResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    savedRequest: z
      .strictObject({
        id: z.string().min(1),
        name: z.string(),
        request: RequestFormSchema,
      })
      .nullable(),
  }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type GetSavedRequestResult = z.infer<typeof GetSavedRequestResultSchema>;

/** Without an id, a new saved request; with one, that saved request saved over. */
export const SaveSavedRequestInputSchema = z.strictObject({
  id: z.string().min(1).optional(),
  name: z.string(),
  request: RequestFormSchema,
});
export type SaveSavedRequestInput = z.infer<typeof SaveSavedRequestInputSchema>;

export const SaveSavedRequestResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    id: z.string().min(1),
    name: z.string(),
  }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type SaveSavedRequestResult = z.infer<
  typeof SaveSavedRequestResultSchema
>;

export const DescribeBodyInputSchema = z.strictObject({
  fileId: z.string().min(1),
  boundary: z.string().min(1),
});
export type DescribeBodyInput = z.infer<typeof DescribeBodyInputSchema>;

/** The parts of a stored multipart body, without their content (plan.md, phase 6). */
export const DescribeBodyResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    parts: z.array(
      z.strictObject({
        name: z.string(),
        filename: z.string().optional(),
        contentType: z.string().optional(),
        offset: z.number().int().nonnegative(),
        length: z.number().int().nonnegative(),
      }),
    ),
  }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type DescribeBodyResult = z.infer<typeof DescribeBodyResultSchema>;

/** A history row. Sends and completions are summaries: no body (review #9). */
export const CallViewSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.enum(['completed', 'in-flight', 'interrupted']),
    send: SendSummarySchema,
    completion: CompletionSummarySchema.nullable(),
  }),
  z.strictObject({
    state: z.literal('unreadable'),
    id: z.string(),
    error: z.string(),
  }),
]);
export type CallView = z.infer<typeof CallViewSchema>;

export const ListCallsResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), calls: z.array(CallViewSchema) }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type ListCallsResult = z.infer<typeof ListCallsResultSchema>;

/**
 * History's list, and a mark that changes whenever the environment's calls change, whatever statuses are selected: the
 * views keyed on History refetch on it (history-status-filter).
 */
export const ListHistoryResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    calls: z.array(CallViewSchema),
    mark: z.string(),
  }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type ListHistoryResult = z.infer<typeof ListHistoryResultSchema>;

/** The statuses the environment's calls were answered with, for the History status filter (history-status-filter). */
export const ListStatusCodesInputSchema = z
  .strictObject({ environmentId: z.string().min(1).optional() })
  .optional();
export type ListStatusCodesInput = z.infer<typeof ListStatusCodesInputSchema>;

const StatusOptionSchema = z.strictObject({
  value: z.string(),
  label: z.string(),
  count: z.number().int().nonnegative(),
});
export type StatusOption = z.infer<typeof StatusOptionSchema>;

export const ListStatusCodesResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), options: z.array(StatusOptionSchema) }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type ListStatusCodesResult = z.infer<typeof ListStatusCodesResultSchema>;

/**
 * History grouped by request (history-grouping): one group per method and URL path, and per Authorization, otherwise
 * Cookie, value when `splitByAuth`; over every call. `auth` is null when not split, and for calls with no auth header.
 */
export const ListRequestGroupsInputSchema = z.strictObject({
  splitByAuth: z.boolean(),
  environmentId: z.string().min(1).optional(),
  statuses: StatusList,
});
export type ListRequestGroupsInput = z.infer<
  typeof ListRequestGroupsInputSchema
>;

const RequestGroupSchema = z.strictObject({
  method: z.string(),
  path: z.string(),
  auth: z
    .strictObject({
      header: z.enum(['Authorization', 'Cookie']),
      value: z.string(),
    })
    .nullable(),
  count: z.number().int().positive(),
  /** The group's newest call, without bodies. */
  latest: z.strictObject({
    state: z.enum(['completed', 'in-flight', 'interrupted']),
    send: SendSummarySchema,
    completion: CompletionSummarySchema.nullable(),
  }),
});
export type RequestGroup = z.infer<typeof RequestGroupSchema>;

export const ListRequestGroupsResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), groups: z.array(RequestGroupSchema) }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type ListRequestGroupsResult = z.infer<
  typeof ListRequestGroupsResultSchema
>;

/** Slice 9: the History search. `""` in a list means "none" (no environment, no Authorization header, …). */
const IdList = z.array(z.string().max(4096)).max(500).optional();
// Authorization values can be long JWTs (code review of history-search, 8).
const AuthList = z.array(z.string().max(65536)).max(500).optional();
export const SearchQuerySchema = z.strictObject({
  text: z.string().max(1024).optional(),
  methods: z.array(z.enum(METHODS)).max(METHODS.length).optional(),
  environmentIds: IdList,
  auths: AuthList,
  savedRequestIds: IdList,
  /** history-status-filter: three-digit codes, `''` for no response. */
  statuses: StatusList,
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

const FacetOptionSchema = z.strictObject({
  value: z.string(),
  label: z.string(),
  detail: z.string().optional(),
  count: z.number().int().nonnegative(),
});
export type FacetOption = z.infer<typeof FacetOptionSchema>;

export const SearchResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    calls: z.array(CallViewSchema),
    total: z.number().int().nonnegative(),
    of: z.number().int().nonnegative(),
    facets: z.strictObject({
      method: z.array(FacetOptionSchema),
      environment: z.array(FacetOptionSchema),
      auth: z.array(FacetOptionSchema),
      savedRequest: z.array(FacetOptionSchema),
      status: z.array(FacetOptionSchema),
    }),
  }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type SearchResult = z.infer<typeof SearchResultSchema>;

/** Slice 10: importing an OpenAPI JSON file as request templates. The server parses it again. */
/** Code review of openapi-import, 9: its own schema, not the call id's. */
export const GetTemplateInputSchema = z.string().min(1).max(64);

export const ImportOpenApiInputSchema = z.strictObject({
  text: z.string().max(20 * 1024 * 1024),
  filename: z.string().max(1024),
  grouping: z.enum(['tag', 'path']),
  useEnvironment: z.boolean(),
  /** What the dialog showed: 'new' never overwrites a source with the same title (slice 11 code review, 7). */
  mode: z.enum(['new', 'reimport']),
});
export type ImportOpenApiInput = z.infer<typeof ImportOpenApiInputSchema>;

/** Slice 12: importing a WSDL file as SOAP templates, filed by port. */
export const ImportWsdlInputSchema = z.strictObject({
  text: z.string().max(20 * 1024 * 1024),
  filename: z.string().max(1024),
  mode: z.enum(['new', 'reimport']),
});
export type ImportWsdlInput = z.infer<typeof ImportWsdlInputSchema>;

export const ImportResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    sourceId: z.string(),
    count: z.number().int().nonnegative(),
    reimported: z.boolean(),
    added: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
  }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type ImportResult = z.infer<typeof ImportResultSchema>;

const TemplateListingSchema = z.strictObject({
  id: z.string(),
  directory: z.string(),
  name: z.string(),
  method: z.string(),
  path: z.string(),
  badge: z.string(),
});
export type TemplateListing = z.infer<typeof TemplateListingSchema>;

const TemplateSourceSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['openapi', 'wsdl']),
  importedAt: z.date(),
  templates: z.array(TemplateListingSchema),
});
export type TemplateSource = z.infer<typeof TemplateSourceSchema>;

export const ListTemplatesResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    sources: z.array(TemplateSourceSchema),
  }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type ListTemplatesResult = z.infer<typeof ListTemplatesResultSchema>;

export const GetTemplateResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    template: z
      .strictObject({
        id: z.string(),
        name: z.string(),
        request: RequestFormSchema,
      })
      .nullable(),
  }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type GetTemplateResult = z.infer<typeof GetTemplateResultSchema>;

/** One opened call, with the full completion including the response body. */
export const CallDetailSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.enum(['completed', 'in-flight', 'interrupted']),
    send: SendDocSchema,
    completion: CompletionDocSchema.nullable(),
  }),
  z.strictObject({
    state: z.literal('unreadable'),
    id: z.string(),
    error: z.string(),
  }),
]);
export type CallDetail = z.infer<typeof CallDetailSchema>;

export const GetCallResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), call: CallDetailSchema.nullable() }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type GetCallResult = z.infer<typeof GetCallResultSchema>;

/** The outcome of one send, with the full completion (including the body) for display. */
export const SendResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    send: SendDocSchema,
    completion: CompletionDocSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({
      kind: z.enum([
        'database-unavailable',
        'not-recorded',
        'invalid-input',
        'cancelled',
        'unexpected',
      ]),
      message: z.string(),
    }),
    /** Present for `not-recorded`: the response that arrived but could not be stored. */
    completion: CompletionDocSchema.optional(),
  }),
]);
export type SendResult = z.infer<typeof SendResultSchema>;

export const DbStatusViewSchema = z.strictObject({
  status: z.enum(['connecting', 'up', 'down', 'not-configured']),
  configPath: z.string(),
  database: z.string().optional(),
  detail: z.string().optional(),
});
export type DbStatusView = z.infer<typeof DbStatusViewSchema>;

/** The API preload exposes on `window.pigeon`. */
export interface PigeonApi {
  send: (input: SendInput) => Promise<SendResult>;
  cancel: (clientRequestId: string) => Promise<void>;
  listCalls: (input?: ListCallsInput) => Promise<ListHistoryResult>;
  dbStatus: () => Promise<DbStatusView>;
  getCall: (sendId: string) => Promise<GetCallResult>;
  listResponses: (input: ListResponsesInput) => Promise<ListCallsResult>;
  listRequestGroups: (
    input: ListRequestGroupsInput,
  ) => Promise<ListRequestGroupsResult>;
  listStatusCodes: (
    input?: ListStatusCodesInput,
  ) => Promise<ListStatusCodesResult>;
  /** Deletes one call for good, with its body files (slice 8). The UI holds it for Undo before calling this. */
  deleteCall: (sendId: string) => Promise<MutationResult>;
  searchCalls: (query: SearchQuery) => Promise<SearchResult>;
  importOpenApi: (input: ImportOpenApiInput) => Promise<ImportResult>;
  importWsdl: (input: ImportWsdlInput) => Promise<ImportResult>;
  listTemplates: () => Promise<ListTemplatesResult>;
  getTemplate: (id: string) => Promise<GetTemplateResult>;
  replay: (input: ReplayInput) => Promise<SendResult>;
  readBody: (input: ReadBodyInput) => Promise<ReadBodyResult>;
  describeBody: (input: DescribeBodyInput) => Promise<DescribeBodyResult>;
  listEnvironments: () => Promise<ListEnvironmentsResult>;
  saveEnvironment: (input: SaveEnvironmentInput) => Promise<MutationResult>;
  deleteEnvironment: (id: string) => Promise<MutationResult>;
  setActiveEnvironment: (id: string | null) => Promise<MutationResult>;
  listSavedRequests: () => Promise<ListSavedRequestsResult>;
  getSavedRequest: (id: string) => Promise<GetSavedRequestResult>;
  saveSavedRequest: (
    input: SaveSavedRequestInput,
  ) => Promise<SaveSavedRequestResult>;
  deleteSavedRequest: (id: string) => Promise<MutationResult>;
}
