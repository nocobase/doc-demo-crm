import {
  createUuid,
  useApiClient,
  useSubmission,
  useNavigationGuard,
  useToaster,
} from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useEffect, useId, useRef, useState } from 'react';
import {
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router';
import { useForm, useWatch } from 'react-hook-form';
import { FeedbackForm } from '#components/feedback-form';
import { RouteDialog } from '#components/route-dialog';
import { useRouteOverlay } from '#components/use-route-overlay';
import { PendingButton } from '#components/pending-button';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Label } from '#components/ui/label';
import { Alert, AlertDescription } from '#components/ui/alert';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '#components/ui/alert-dialog';
import { Loading } from '#components/loading';
import { useListData } from '#hooks/use-list-data';
import { ReadError } from '../customers/shared.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import type { SalesContext, Product } from './types.js';
import type { ListResult } from '../customers/types.js';

type LineValues = {
  clientKey: string;
  productId: string;
  productName?: string;
  quantity: number;
  unitPrice: number;
  discount: number;
};
type Values = {
  name: string;
  code?: string;
  unitPrice?: number;
  stage?: string;
  notes?: string;
  lines?: LineValues[];
};
export default function SalesEditor() {
  const location = useLocation();
  const params = useParams();
  const { t } = useTranslation();
  const context = useOutletContext<SalesContext>();
  const kind = location.pathname.includes('/products')
    ? 'product'
    : params.quoteId || location.pathname.endsWith('/newQuote')
      ? 'quote'
      : 'opportunity';
  const editing = location.pathname.endsWith('/edit');
  const productRequest = useListData<{ data: Product }>(
    `crmSales/products/${params.productId}`,
    { active: kind === 'product' && editing },
  );
  if (kind === 'product' && editing && productRequest.error)
    return (
      <RouteDialog title={t('sales.editProduct')}>
        <ReadError error={productRequest.error} retry={productRequest.reload} />
      </RouteDialog>
    );
  if (
    editing &&
    (kind === 'product'
      ? !productRequest.data
      : kind === 'quote'
        ? !context.quote
        : !context.opportunity)
  )
    return (
      <RouteDialog title={t('sales.products')}>
        <Loading />
      </RouteDialog>
    );
  return (
    <Editor
      key={`${kind}-${params.productId ?? params.quoteId ?? params.opportunityId ?? 'new'}-${editing}`}
      kind={kind}
      editing={editing}
      context={{ ...context, product: productRequest.data?.data }}
    />
  );
}
function Cancel({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const { close } = useRouteOverlay();
  return (
    <Button variant='outline' disabled={disabled} onClick={() => void close()}>
      {t('crm.cancel')}
    </Button>
  );
}
function Editor({
  kind,
  editing,
  context,
}: {
  kind: 'product' | 'opportunity' | 'quote';
  editing: boolean;
  context: SalesContext;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const { session } = useAuthentication();
  const formId = useId();
  const navigate = useNavigate();
  const toaster = useToaster();
  const { customerId, opportunityId, productId, quoteId } = useParams();
  const record =
    kind === 'product'
      ? context.product
      : kind === 'quote'
        ? context.quote
        : context.opportunity;
  const initial: Values =
    kind === 'product'
      ? {
          name: editing ? context.product!.name : '',
          code: editing ? context.product!.code : '',
          unitPrice: editing ? context.product!.unitPrice : 0,
        }
      : kind === 'opportunity'
        ? {
            name: editing ? context.opportunity!.name : '',
            stage: editing ? context.opportunity!.stage : 'discovery',
            notes: editing ? context.opportunity!.notes : '',
          }
        : {
            name: editing ? context.quote!.name : '',
            lines: editing
              ? context.quote!.lines.map(
                  ({
                    productId,
                    productName,
                    quantity,
                    unitPrice,
                    discount,
                  }) => ({
                    clientKey: createUuid(),
                    productId,
                    productName,
                    quantity,
                    unitPrice,
                    discount,
                  }),
                )
              : [],
          };
  const form = useForm<Values>({
    defaultValues: initial,
    shouldFocusError: false,
  });
  const watched = useWatch({ control: form.control });
  const submission = useSubmission({
    scope: `${session?.user.id}:crmSales:${kind}:${productId ?? quoteId ?? opportunityId ?? customerId ?? 'new'}:${editing ? 'edit' : 'create'}`,
  });
  const [error, setError] = useState<unknown>();
  const savedRef = useRef(false);
  const [attempted, setAttempted] = useState(false);
  const restoring = submission.pending && !attempted;
  const [confirm, setConfirm] = useState(false);
  const decisionRef = useRef<{
    promise: Promise<boolean>;
    resolve: (value: boolean) => void;
  } | null>(null);
  function decide(value: boolean) {
    decisionRef.current?.resolve(value);
    decisionRef.current = null;
    setConfirm(false);
  }
  useEffect(
    () => () => {
      decisionRef.current?.resolve(false);
    },
    [],
  );
  useNavigationGuard(() => {
    if (savedRef.current) return true;
    if (submission.submitting || submission.pending) return false;
    if (!form.formState.isDirty) return true;
    if (decisionRef.current) return decisionRef.current.promise;
    let resolve!: (value: boolean) => void;
    const promise = new Promise<boolean>((done) => {
      resolve = done;
    });
    decisionRef.current = { promise, resolve };
    setConfirm(true);
    return promise;
  });
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (form.formState.isDirty || submission.pending || submission.submitting)
        event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [form.formState.isDirty, submission.pending, submission.submitting]);
  const submit = async () => {
    try {
      const result = await submission.run(
        form.getValues(),
        async (key, signal, values) => {
          setError(undefined);
          let valid = false;
          await form.handleSubmit(() => {
            valid = true;
          })();
          if (!valid) return;
          setAttempted(true);
          const base =
            kind === 'product'
              ? 'crmSales/products'
              : `crmSales/customers/${customerId}/opportunities${kind === 'quote' ? `/${opportunityId}/quotes` : ''}`;
          const path = `${base}${editing ? `/${record!.id}` : ''}`;
          const payload =
            kind === 'quote'
              ? {
                  ...values,
                  lines: values.lines?.map(
                    ({ productName: _name, clientKey: _clientKey, ...line }) =>
                      line,
                  ),
                }
              : values;
          return api.request({
            path,
            method: editing ? 'PATCH' : 'POST',
            headers: { 'Idempotency-Key': key },
            signal,
            json: payload,
          });
        },
      );
      if (!result) return;
      savedRef.current = true;
      toaster.show({ type: 'success', title: t('crm.saved') });
      context.reload();
      void navigate(kind === 'product' ? '/products' : '..', {
        relative: 'path',
      });
    } catch (failure) {
      setError(failure);
    }
  };
  const title = `${editing ? 'edit' : 'new'}${kind === 'product' ? 'Product' : kind === 'quote' ? 'Quote' : 'Opportunity'}`;
  return (
    <RouteDialog
      title={t(`sales.${title}`)}
      className={kind === 'quote' ? 'sm:max-w-4xl' : 'sm:max-w-xl'}
      beforeClose={() => !submission.submitting && !submission.pending}
      footer={
        <>
          <Cancel disabled={submission.submitting || submission.pending} />
          <PendingButton
            type='submit'
            form={formId}
            busy={submission.submitting}
            disabled={!session}
            pendingLabel={t('crm.saving')}
          >
            {t('crm.save')}
          </PendingButton>
        </>
      }
    >
      <AlertDialog
        open={confirm}
        onOpenChange={(open) => {
          if (!open) decide(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('crm.discard')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('crm.discardHint')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('crm.keepEditing')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => decide(true)}>
              {t('crm.discardAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {submission.pending ? (
        <Alert>
          <AlertDescription>
            {t(restoring ? 'crm.restoreInput' : 'crm.uncertain')}
          </AlertDescription>
        </Alert>
      ) : null}
      <FeedbackForm
        id={formId}
        error={error}
        submitting={submission.submitting}
        validationErrors={form.formState.errors}
        onSubmit={async (event) => {
          event.preventDefault();
          await submit();
        }}
      >
        <fieldset
          disabled={submission.submitting || (submission.pending && !restoring)}
          className='grid gap-4'
        >
          <div className='space-y-2'>
            <Label htmlFor={`${formId}-name`}>{t('sales.name')}</Label>
            <Input
              id={`${formId}-name`}
              {...form.register('name', {
                required: t('crm.required'),
                validate: (v) => Boolean(v.trim()) || t('crm.required'),
                maxLength: 120,
              })}
            />
          </div>
          {kind === 'product' ? (
            <>
              <div className='space-y-2'>
                <Label htmlFor={`${formId}-code`}>{t('sales.code')}</Label>
                <Input
                  id={`${formId}-code`}
                  {...form.register('code', {
                    required: t('crm.required'),
                    maxLength: 40,
                  })}
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor={`${formId}-price`}>
                  {t('sales.unitPrice')}
                </Label>
                <Input
                  id={`${formId}-price`}
                  type='number'
                  min={0}
                  max={100000}
                  step='0.01'
                  {...form.register('unitPrice', {
                    valueAsNumber: true,
                    required: t('crm.required'),
                    min: 0,
                    max: 100000,
                  })}
                />
              </div>
            </>
          ) : null}
          {kind === 'opportunity' ? (
            <>
              <div className='space-y-2'>
                <Label>{t('sales.stage')}</Label>
                <Select
                  items={['discovery', 'proposal', 'won', 'lost'].map((v) => ({
                    value: v,
                    label: t(`sales.${v}`),
                  }))}
                  value={watched.stage}
                  onValueChange={(v) => {
                    if (v) form.setValue('stage', v, { shouldDirty: true });
                  }}
                >
                  <SelectTrigger aria-label={t('sales.stage')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['discovery', 'proposal', 'won', 'lost'].map((v) => (
                      <SelectItem key={v} value={v}>
                        {t(`sales.${v}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-2'>
                <Label htmlFor={`${formId}-notes`}>{t('crm.notes')}</Label>
                <Textarea
                  id={`${formId}-notes`}
                  {...form.register('notes', { maxLength: 4000 })}
                />
              </div>
            </>
          ) : null}
          {kind === 'quote' ? (
            <QuoteLines
              lines={(watched.lines ?? []) as LineValues[]}
              onChange={(lines) =>
                form.setValue('lines', lines, { shouldDirty: true })
              }
            />
          ) : null}
        </fieldset>
      </FeedbackForm>
    </RouteDialog>
  );
}

function QuoteLines({
  lines,
  onChange,
}: {
  lines: LineValues[];
  onChange: (lines: LineValues[]) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const request = useListData<ListResult<Product>>(
    `crmSales/products?q=${encodeURIComponent(search)}&page=${page}`,
  );
  const change = (
    index: number,
    key: 'quantity' | 'unitPrice' | 'discount',
    value: string,
  ) =>
    onChange(
      lines.map((line, i) =>
        i === index ? { ...line, [key]: Number(value) } : line,
      ),
    );
  return (
    <section className='space-y-4'>
      <p className='text-sm text-muted-foreground'>{t('sales.snapshotHint')}</p>
      <div className='space-y-2'>
        <Label htmlFor={`${id}-search`}>{t('sales.searchProducts')}</Label>
        <Input
          id={`${id}-search`}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {request.error ? (
        <ReadError error={request.error} retry={request.reload} />
      ) : (
        <Select
          value={null}
          items={(request.data?.data ?? []).map((p) => ({
            value: p.id,
            label: `${p.name} (${p.code})`,
          }))}
          onValueChange={(value) => {
            const p = request.data?.data.find((p) => p.id === value);
            if (p)
              onChange([
                ...lines,
                {
                  productId: p.id,
                  productName: p.name,
                  clientKey: createUuid(),
                  quantity: 1,
                  unitPrice: p.unitPrice,
                  discount: 0,
                },
              ]);
          }}
        >
          <SelectTrigger
            aria-label={t('sales.addLine')}
            disabled={request.loading || lines.length >= 100}
          >
            <SelectValue placeholder={t('sales.addLine')} />
          </SelectTrigger>
          <SelectContent>
            {(request.data?.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name} ({p.code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {(request.data?.meta.total ?? 0) > 20 ? (
        <div className='flex gap-2'>
          <Button
            type='button'
            variant='outline'
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            {t('sales.previous')}
          </Button>
          <Button
            type='button'
            variant='outline'
            disabled={page * 20 >= (request.data?.meta.total ?? 0)}
            onClick={() => setPage(page + 1)}
          >
            {t('sales.next')}
          </Button>
        </div>
      ) : null}
      {lines.length === 0 ? <p>{t('sales.addLineHint')}</p> : null}
      {lines.map((line, index) => (
        <div
          key={line.clientKey}
          className='grid gap-3 rounded-lg border p-3 sm:grid-cols-4'
        >
          <p className='font-medium sm:col-span-4'>{line.productName}</p>
          {(['quantity', 'unitPrice', 'discount'] as const).map((key) => (
            <div className='space-y-2' key={key}>
              <Label htmlFor={`${id}-${index}-${key}`}>
                {t(`sales.${key}`)}
              </Label>
              <Input
                id={`${id}-${index}-${key}`}
                type='number'
                min={key === 'quantity' ? 1 : 0}
                max={
                  key === 'quantity' ? 10000 : key === 'discount' ? 100 : 100000
                }
                step={key === 'quantity' ? 1 : 0.01}
                required
                value={line[key]}
                onChange={(e) => change(index, key, e.target.value)}
              />
            </div>
          ))}
          <Button
            type='button'
            variant='outline'
            className='self-end'
            onClick={() => onChange(lines.filter((_, i) => i !== index))}
          >
            {t('sales.removeLine')}
          </Button>
        </div>
      ))}
    </section>
  );
}
