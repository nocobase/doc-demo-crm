import { useTranslation } from '@nocobase/i18n/client';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useEffect, useMemo, useState, useRef, type ReactElement } from 'react';

import type {
  FilePreviewDialogProps,
  FileRecord,
  FileUiLabels,
} from '../types.js';
import {
  isActiveMarkupMimeType,
  resolveFilePreviewKind,
  type FilePreviewKind,
} from '../lib/file-preview.js';
import { Button } from '#components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '#components/ui/dialog';
import { fileUrlCredentials, resolveSafeFileUrl } from '../lib/file-url.js';
import { FilePreviewContent } from './previewers/file-preview-content.js';

const PDF_MIME_TYPE = 'application/pdf';
const PDF_PREVIEW_ERROR = 'Unable to load the PDF preview.';
const PDF_MARKUP_RESPONSE_ERROR =
  'The file URL returned HTML or XML instead of a PDF.';

export function FilePreviewDialog({
  files,
  initialIndex = 0,
  returnFocus,
  open,
  onOpenChange,
  onDownload,
  download: allowDownload = true,
  labels,
  onError,
}: FilePreviewDialogProps): ReactElement | null {
  if (!open || !files.length) return null;
  const normalizedIndex = Math.max(0, Math.min(initialIndex, files.length - 1));
  return (
    <OpenFilePreviewDialog
      key={`${normalizedIndex}:${files.map((file) => file.id).join(':')}`}
      files={files}
      initialIndex={normalizedIndex}
      returnFocus={returnFocus}
      onOpenChange={onOpenChange}
      onDownload={onDownload}
      download={allowDownload}
      labels={labels}
      onError={onError}
    />
  );
}

interface OpenFilePreviewDialogProps {
  readonly returnFocus?: () => HTMLElement | null;
  readonly files: readonly FileRecord[];
  readonly initialIndex: number;
  readonly onOpenChange: (open: boolean) => void;
  readonly onDownload?: FilePreviewDialogProps['onDownload'];
  readonly download: boolean;
  readonly labels?: FileUiLabels;
  readonly onError?: (error: Error) => void;
}

function OpenFilePreviewDialog(
  inputProps: OpenFilePreviewDialogProps,
): ReactElement {
  const { t } = useTranslation();
  const {
    files,
    initialIndex,
    returnFocus,
    onOpenChange,
    onDownload,
    download: allowDownload,
    labels,
    onError,
  } = inputProps;

  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' &&
      document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const [index, setIndex] = useState(initialIndex);
  // App customization: download failures must remain visible inside the open preview.
  const [downloadFailed, setDownloadFailed] = useState(false);
  const handleDownloadError = (error: unknown) => {
    setDownloadFailed(true);
    reportDownloadError(onError, error);
  };
  const file = files[index];
  if (!file) throw new Error('A preview file is required.');
  const downloadLabel =
    labels?.download ??
    t('fileUi.files.download', { defaultValue: 'Download' });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        finalFocus={returnFocus ?? returnFocusRef}
        className='flex max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] flex-col sm:max-w-4xl'
        showCloseButton
      >
        <div className='flex items-center justify-between gap-3 pr-10'>
          <div className='min-w-0'>
            <div className='flex min-w-0 items-center gap-2'>
              <DialogTitle className='truncate' title={file.filename}>
                {file.filename}
              </DialogTitle>
              {allowDownload ? (
                <Button
                  type='button'
                  size='icon'
                  className='shrink-0'
                  variant='ghost'
                  aria-label={`${downloadLabel}: ${file.filename}`}
                  onClick={() =>
                    void downloadFile(file, onDownload).catch(
                      (error: unknown) => handleDownloadError(error),
                    )
                  }
                >
                  <Download aria-hidden='true' />
                </Button>
              ) : null}
            </div>
            <p className='text-sm text-muted-foreground'>{file.mimeType}</p>
          </div>
          <div className='flex shrink-0 gap-1'>
            {files.length > 1 ? (
              <>
                <Button
                  type='button'
                  size='icon'
                  variant='ghost'
                  aria-label={t('fileUi.files.previous', {
                    defaultValue: 'Previous file',
                  })}
                  onClick={() =>
                    setIndex(
                      (value) => (value - 1 + files.length) % files.length,
                    )
                  }
                >
                  <ChevronLeft aria-hidden='true' />
                </Button>
                <Button
                  type='button'
                  size='icon'
                  variant='ghost'
                  aria-label={t('fileUi.files.next', {
                    defaultValue: 'Next file',
                  })}
                  onClick={() =>
                    setIndex((value) => (value + 1) % files.length)
                  }
                >
                  <ChevronRight aria-hidden='true' />
                </Button>
              </>
            ) : null}
          </div>
        </div>
        {downloadFailed ? (
          <p role='alert' className='text-sm text-destructive'>
            {t('fileUi.downloadFailed')}
          </p>
        ) : null}
        {/* Only the preview scrolls; the title and its actions stay in view. */}
        <div className='-mx-4 min-h-0 flex-1 overflow-auto px-4'>
          <PreviewBody
            key={`${file.id}:${String(file.updatedAt)}:${file.contentUrl}`}
            file={file}
            onDownload={
              allowDownload
                ? () =>
                    void downloadFile(file, onDownload).catch(
                      (error: unknown) => handleDownloadError(error),
                    )
                : undefined
            }
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

async function downloadFile(
  file: FileRecord,
  onDownload?: FilePreviewDialogProps['onDownload'],
): Promise<void> {
  if (onDownload) {
    await onDownload(file);
    return;
  }
  const raw = file.contentUrl;
  const url = raw ? resolveSafeFileUrl(raw) : undefined;
  if (!url) throw new Error('File URL is not allowed.');
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.rel = 'noopener';
  link.click();
}

function reportDownloadError(
  onError: ((error: Error) => void) | undefined,
  error: unknown,
): void {
  onError?.(
    error instanceof Error ? error : new Error('File download failed.'),
  );
}

// A blob URL is same-origin, so the frame must receive the bytes as a PDF and
// never as a document the browser would render and run. This retyping is the
// safeguard; refusing an active markup response turns an HTML answer, such as
// a login page, into an error that names the cause instead of a broken viewer.
function asPdfBlob(blob: Blob): Blob {
  return blob.type === PDF_MIME_TYPE
    ? blob
    : blob.slice(0, blob.size, PDF_MIME_TYPE);
}

function PreviewBody({
  file,
  onDownload,
}: {
  file: FileRecord;
  onDownload?: () => void;
}): ReactElement {
  const sourceUrl = resolveSafeFileUrl(file.contentUrl ?? '');
  const [text, setText] = useState<string>();
  const [blobUrl, setBlobUrl] = useState<string>();
  const [error, setError] = useState<string | undefined>(() =>
    !sourceUrl ? 'File URL is missing or not allowed.' : undefined,
  );
  const kind: FilePreviewKind = useMemo(
    () => resolveFilePreviewKind(file),
    [file],
  );
  // The content route downloads PDFs as attachments; a local blob can be embedded.
  useEffect(() => {
    if (!sourceUrl || kind !== 'pdf') return undefined;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void fetch(sourceUrl, {
      credentials: fileUrlCredentials(sourceUrl),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(PDF_PREVIEW_ERROR);
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        if (isActiveMarkupMimeType(blob.type))
          throw new Error(PDF_MARKUP_RESPONSE_ERROR);
        objectUrl = URL.createObjectURL(asPdfBlob(blob));
        setBlobUrl(objectUrl);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : PDF_PREVIEW_ERROR);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sourceUrl, kind]);
  const url = kind === 'pdf' ? blobUrl : sourceUrl;
  useEffect(() => {
    if (!url || !['text', 'markdown'].includes(kind)) return undefined;
    const controller = new AbortController();
    void fetch(url, {
      credentials: fileUrlCredentials(url),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok)
          throw new Error(`Preview request failed (${response.status}).`);
        return response.text();
      })
      .then(setText)
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError'))
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to load the file preview.',
          );
      });
    return () => controller.abort();
  }, [file, kind, url]);
  return (
    <FilePreviewContent
      file={file}
      kind={kind}
      url={url}
      text={text}
      error={error}
      onDownload={onDownload}
    />
  );
}
