// Slice 10 (openapi-import): screen 05. An OpenAPI JSON file is previewed by tag or path segment, generated into the
// Templates tab's tree, and a template opens into the form and sends to the active environment's baseUrl.
import { expect, test } from '@playwright/test';
import { BILLING } from '../test-support/wsdl-fixture';
import {
  type CaptureServer,
  startCaptureServer,
} from '../test-support/capture-server';
import {
  type TestApp,
  launchWithTestDatabase,
  openEnvironments,
  rowName,
  showRequest,
  showSidebarTab,
} from './support';

let capture: CaptureServer;
let testApp: TestApp;

const spec = {
  openapi: '3.1.0',
  info: { title: 'Orders API', version: '2.4' },
  servers: [{ url: 'https://staging.api' }],
  paths: {
    '/orders': {
      get: { tags: ['orders'], summary: 'List orders' },
      post: {
        tags: ['orders'],
        requestBody: {
          content: { 'application/json': { example: { sku: 'PGN-01' } } },
        },
      },
    },
    '/orders/{id}': { delete: { tags: ['orders'] } },
    '/customers': { get: { tags: ['customers'] } },
  },
};

test.beforeAll(async () => {
  capture = await startCaptureServer();
  testApp = await launchWithTestDatabase();
  await expect(testApp.window.getByTestId('db-status')).toContainText(
    `up (${testApp.database})`,
    { timeout: 15_000 },
  );
});

test.afterAll(async () => {
  await testApp?.close();
  await capture?.close();
});

const button = (name: string) =>
  testApp.window.getByRole('button', { name, exact: true });
const dialog = () =>
  testApp.window.getByRole('dialog', { name: 'Import templates' });
const tree = () => testApp.window.getByTestId('templates-tree');

test('a spec is previewed by tag or path segment, and Generate files it into the Templates tree', async () => {
  const { window } = testApp;
  await window.getByRole('tab', { name: 'Templates', exact: true }).click();
  await button('Import OpenAPI / WSDL').click();
  await dialog()
    .getByLabel('Spec file')
    .setInputFiles({
      name: 'orders-api.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(spec)),
    });
  await expect(dialog()).toContainText(
    'OpenAPI 3.1.0 · Orders API v2.4 · 4 operations',
  );
  const preview = dialog().getByTestId('import-preview');
  await expect(preview).toContainText('orders/ 3');
  await expect(preview).toContainText('customers/ 1');

  await dialog().getByRole('button', { name: 'Path segment' }).click();
  await expect(preview).toContainText('orders/ 3');
  await dialog().getByRole('button', { name: 'Tag' }).click();

  await dialog().getByRole('button', { name: 'Generate 4 templates' }).click();
  await expect(dialog()).toBeHidden();
  await expect(tree()).toContainText('Orders API');
  await expect(
    tree().getByRole('button', { name: /^GET \/orders\b/ }),
  ).toBeVisible();
  await expect(
    tree().getByRole('button', { name: /^DELETE \/orders\/\{id\}/ }),
  ).toBeVisible();
});

test('a template opens into the form and sends to the active environment', async () => {
  const { window } = testApp;
  await openEnvironments(window);
  await window.getByLabel('New environment name').fill('capture');
  await window.getByLabel('New environment base address').fill(capture.url);
  await button('Add environment').click();
  await button('Environments').click();
  await window
    .getByLabel('Environment', { exact: true })
    .selectOption({ label: `capture — ${capture.url}/` });

  await window.getByRole('tab', { name: 'Templates', exact: true }).click();
  await tree()
    .getByRole('button', { name: /^POST \/orders\b/ })
    .click();
  await expect(window.getByLabel('Method')).toHaveValue('POST');
  await expect(window.getByLabel('URL')).toHaveValue('/orders');
  await expect(window.getByLabel('Body text')).toHaveValue(
    '{\n  "sku": "PGN-01"\n}',
  );
  capture.respondWith({ status: 201, body: Buffer.from('made') });
  await button('Send').click();
  await expect(window.getByTestId('result')).toContainText('201');
  expect(capture.requests.at(-1)?.url).toBe('/orders');
  await showRequest(window);
  await showSidebarTab(window, 'History');
  await expect(
    rowName(window.getByTestId('history').getByRole('listitem').first()),
  ).toHaveAccessibleName(new RegExp(`^POST ${capture.url}/orders — 201`));
});

// Slice 11 (reimport-and-errors).
test('re-importing a changed spec updates the tree in place and leaves History alone', async () => {
  const { window } = testApp;
  await showSidebarTab(window, 'History');
  const historyCount = await window
    .getByTestId('history')
    .getByRole('listitem')
    .count();
  const changed = {
    ...spec,
    paths: {
      '/orders': spec.paths['/orders'],
      '/orders/{id}': spec.paths['/orders/{id}'],
      '/invoices': { get: { tags: ['invoices'] } },
    },
  };
  await window.getByRole('tab', { name: 'Templates', exact: true }).click();
  await button('Import OpenAPI / WSDL').click();
  await dialog()
    .getByLabel('Spec file')
    .setInputFiles({
      name: 'orders-api-v2.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(changed)),
    });
  await expect(dialog()).toContainText('Re-imports “Orders API”');
  await dialog().getByRole('button', { name: 'Update 4 templates' }).click();
  await expect(dialog()).toBeHidden();
  await expect(testApp.window.getByTestId('import-outcome')).toContainText(
    '1 added · 3 updated · 1 removed',
  );
  await expect(
    tree().getByRole('button', { name: /^GET \/invoices\b/ }),
  ).toBeVisible();
  await expect(
    tree().getByRole('button', { name: /^GET \/customers\b/ }),
  ).toHaveCount(0);
  await expect(tree().getByText('Orders API')).toHaveCount(1);
  await showSidebarTab(window, 'History');
  await expect(window.getByTestId('history').getByRole('listitem')).toHaveCount(
    historyCount,
  );
});

test('an invalid file says where it failed and cannot be generated', async () => {
  const { window } = testApp;
  await window.getByRole('tab', { name: 'Templates', exact: true }).click();
  await button('Import OpenAPI / WSDL').click();
  await dialog()
    .getByLabel('Spec file')
    .setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{\n  "openapi": "3.0.0",\n  "paths": {,}\n}'),
    });
  await expect(dialog().getByRole('alert')).toContainText('line 3, column 13');
  await expect(
    dialog().getByRole('button', { name: /^(Generate|Update) / }),
  ).toBeDisabled();
  await dialog().getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog()).toBeHidden();
});

// Slice 12 (wsdl-import).
test('a WSDL is previewed by port, generated as SOAP templates, and one sends and is recorded', async () => {
  const { window } = testApp;
  const wsdl = BILLING.replaceAll('http://localhost:8080', capture.url);
  await window.getByRole('tab', { name: 'Templates', exact: true }).click();
  await button('Import OpenAPI / WSDL').click();
  await dialog().getByRole('button', { name: 'WSDL', exact: true }).click();
  await dialog()
    .getByLabel('Spec file')
    .setInputFiles({
      name: 'billing.wsdl',
      mimeType: 'text/xml',
      buffer: Buffer.from(wsdl),
    });
  await expect(dialog()).toContainText(
    'WSDL · BillingService · 2 ports · 4 operations',
  );
  const preview = dialog().getByTestId('import-preview');
  await expect(preview).toContainText('BillingPort/ 2');
  await expect(preview).toContainText('BillingPort12/ 2');
  await dialog().getByRole('button', { name: 'Generate 4 templates' }).click();
  await expect(dialog()).toBeHidden();

  await tree()
    .getByRole('button', { name: /^SOAP CreateInvoice/ })
    .first()
    .click();
  await expect(window.getByLabel('Method')).toHaveValue('POST');
  await expect(window.getByLabel('URL')).toHaveValue(`${capture.url}/billing`);
  await expect(window.getByLabel('Body text')).toHaveValue(
    /<tns:CreateInvoice>/,
  );
  capture.respondWith({ status: 200, body: Buffer.from('<ok/>') });
  await button('Send').click();
  await expect(window.getByTestId('result')).toContainText('200');
  const received = capture.requests.at(-1);
  const raw = received?.rawHeaders ?? [];
  const soapAction =
    raw[raw.findIndex((h) => h.toLowerCase() === 'soapaction') + 1];
  expect(soapAction).toBe('"urn:CreateInvoice"');
  expect(received?.body.toString()).toContain(
    '<tns:customerId></tns:customerId>',
  );
});
