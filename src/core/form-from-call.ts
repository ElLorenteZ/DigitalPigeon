// Turns a recorded request into form input for edit-and-send. Managed headers are left out when they
// equal what wire.ts generates, and kept as rows when they differ, such as a typed Host (plan.md).
// Pure: the renderer imports this.
import { METHODS_WITH_LENGTH, type WireInput, type WireRequest } from './wire';

export function formFromCall({ method, url, headers }: WireRequest): WireInput {
  const generated = (name: string, value: string): boolean => {
    switch (name.toLowerCase()) {
      case 'host':
        return value === new URL(url).host;
      case 'connection':
        return value === (method === 'HEAD' ? 'close' : 'keep-alive');
      case 'content-length':
        return METHODS_WITH_LENGTH.has(method) && value === '0';
      default:
        return false;
    }
  };

  return {
    method,
    // The recorded URL already includes its query string.
    url,
    queryRows: [],
    headerRows: headers.filter(([name, value]) => !generated(name, value)),
  };
}
