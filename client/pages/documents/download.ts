import type { FileRecord } from '#extensions/nocobase-file-component-ui/index';
export async function downloadFile(
  file: Pick<FileRecord, 'contentUrl' | 'filename' | 'mimeType'>,
) {
  if (!file.contentUrl) throw new Error('File unavailable');
  const response = await fetch(file.contentUrl, { credentials: 'same-origin' });
  if (
    !response.ok ||
    (response.headers.get('content-type')?.includes('text/html') &&
      file.mimeType !== 'text/html') ||
    (response.headers.get('content-type')?.includes('application/json') &&
      !file.mimeType.includes('json'))
  )
    throw new Error('File unavailable');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
