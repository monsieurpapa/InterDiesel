import { useState } from 'preact/hooks';
import { db, engine, go, t, toast, useLive, useSession, useStock } from '../state';
import { Empty, Field, Icon, Page, Section, Seg } from '../ui';
import { ProductPick } from './stock';
import { receiveIdFor } from '../../shared/derive';
import { transferRequestText, transferSendText } from '../../shared/messages';
import { fmtDateTime } from '../../shared/time';
import type { TransferLine, TransferReceive, TransferRequest, TransferSend } from '../../shared/types';
import { sendWhatsApp } from '../share';

function useTransfers(storeId: string) {
  return useLive(
    async () => {
      const sends = (await db.transfer_send.toArray()) as TransferSend[];
      const recvs = (await db.transfer_receive.toArray()) as TransferReceive[];
      const reqs = (await db.transfer_request.toArray()) as TransferRequest[];
      const recvBy = new Map(recvs.map((r) => [r.sendId, r]));
      const sentFor = new Set(sends.map((x) => x.requestId).filter(Boolean));
      return {
        incoming: sends.filter((x) => x.toStoreId === storeId && !recvBy.has(x.id)).sort((a, b) => b.at - a.at),
        outgoing: sends.filter((x) => x.storeId === storeId && !recvBy.has(x.id)).sort((a, b) => b.at - a.at),
        askedOfMe: reqs.filter((r) => r.fromStoreId === storeId && !sentFor.has(r.id)).sort((a, b) => b.at - a.at),
        myRequests: reqs.filter((r) => r.storeId === storeId && !sentFor.has(r.id)).sort((a, b) => b.at - a.at),
        done: sends.filter((x) => (x.storeId === storeId || x.toStoreId === storeId) && recvBy.has(x.id)).sort((a, b) => b.at - a.at).slice(0, 40),
        recvBy,
      };
    },
    [storeId],
    null as any,
  );
}

export function TransfersPage() {
  const s = useSession();
  const data = useTransfers(s.storeId);
  const [tab, setTab] = useState<'open' | 'requests' | 'done'>('open');
  const name = (id: string) => s.stores.find((x) => x.id === id)?.name ?? id;
  if (!data) return null;
  const lines = (l: TransferLine[]) => l.map((x) => `${x.qty}× ${s.productById.get(x.productId)?.name ?? x.productId}`).join(', ');

  return (
    <Page title={t('transfers.title')} back="/menu">
      <div class="grid2" style={{ marginBottom: 10 }}>
        {s.can('transfer.send') && (
          <a class="btn dark" href="#/transfer/new"><Icon.truck />{t('transfers.send')}</a>
        )}
        <a class="btn" href="#/transfer/request">{t('transfers.request')}</a>
      </div>
      <Seg
        value={tab}
        onChange={setTab}
        options={[
          { value: 'open', label: t('transfers.tabOpen', { n: data.incoming.length + data.outgoing.length }) },
          { value: 'requests', label: t('transfers.tabRequests', { n: data.askedOfMe.length + data.myRequests.length }) },
          { value: 'done', label: t('transfers.tabDone') },
        ]}
      />
      {tab === 'open' && (
        <>
          <Section title={t('transfers.incoming')} />
          <div class="list">
            {data.incoming.map((x: TransferSend) => (
              <a class="item" href={`#/transfer/${x.id}`}>
                <div class="main">
                  <div class="title">{t('transfers.from', { store: name(x.storeId) })}</div>
                  <div class="sub">{fmtDateTime(x.at)} · {lines(x.lines)}</div>
                </div>
                <span class="tag warn">{t('transfers.toReceive')}</span>
              </a>
            ))}
            {!data.incoming.length && <Empty>{t('transfers.noIncoming')}</Empty>}
          </div>
          <Section title={t('transfers.outgoing')} />
          <div class="list">
            {data.outgoing.map((x: TransferSend) => (
              <a class="item" href={`#/transfer/${x.id}`}>
                <div class="main">
                  <div class="title">{t('transfers.to', { store: name(x.toStoreId) })}</div>
                  <div class="sub">{fmtDateTime(x.at)} · {lines(x.lines)}</div>
                </div>
                <span class="tag">{t('transfers.inTransit')}</span>
              </a>
            ))}
            {!data.outgoing.length && <Empty>{t('transfers.noOutgoing')}</Empty>}
          </div>
        </>
      )}
      {tab === 'requests' && (
        <>
          <Section title={t('transfers.askedOfMe')} />
          <div class="list">
            {data.askedOfMe.map((r: TransferRequest) => (
              <a class="item" href={`#/transfer/${r.id}`}>
                <div class="main">
                  <div class="title">{t('transfers.requestFrom', { store: name(r.storeId) })}</div>
                  <div class="sub">{fmtDateTime(r.at)} · {lines(r.lines)}</div>
                </div>
              </a>
            ))}
            {!data.askedOfMe.length && <Empty>{t('transfers.noRequests')}</Empty>}
          </div>
          <Section title={t('transfers.myRequests')} />
          <div class="list">
            {data.myRequests.map((r: TransferRequest) => (
              <a class="item" href={`#/transfer/${r.id}`}>
                <div class="main">
                  <div class="title">{t('transfers.requestTo', { store: name(r.fromStoreId) })}</div>
                  <div class="sub">{fmtDateTime(r.at)} · {lines(r.lines)}</div>
                </div>
              </a>
            ))}
            {!data.myRequests.length && <Empty>{t('transfers.noRequests')}</Empty>}
          </div>
        </>
      )}
      {tab === 'done' && (
        <div class="list" style={{ marginTop: 8 }}>
          {data.done.map((x: TransferSend) => {
            const r = data.recvBy.get(x.id)!;
            const gap = x.lines.some((l) => (r.lines.find((y) => y.productId === l.productId)?.qty ?? 0) !== l.qty);
            return (
              <a class="item" href={`#/transfer/${x.id}`}>
                <div class="main">
                  <div class="title">{name(x.storeId)} → {name(x.toStoreId)}</div>
                  <div class="sub">{fmtDateTime(r.at)} · {lines(x.lines)}</div>
                </div>
                {gap ? <span class="tag bad">{t('transfers.gap')}</span> : <span class="tag ok">{t('transfers.received')}</span>}
              </a>
            );
          })}
          {!data.done.length && <Empty>{t('transfers.noneDone')}</Empty>}
        </div>
      )}
    </Page>
  );
}

function LinesEditor(props: { lines: TransferLine[]; setLines: (l: TransferLine[]) => void; stockLabel?: (pid: string) => string }) {
  const s = useSession();
  const [q, setQ] = useState('');
  const set = (i: number, qty: number) => props.setLines(props.lines.map((l, j) => (j === i ? { ...l, qty } : l)));
  return (
    <div class="stack">
      <div class="list">
        {props.lines.map((l, i) => {
          const p = s.productById.get(l.productId);
          return (
            <div class="item" style={{ cursor: 'default' }}>
              <div class="main">
                <div class="title">{p?.name}</div>
                <div class="sub">{p?.ref}{props.stockLabel ? ` · ${props.stockLabel(l.productId)}` : ''}</div>
              </div>
              <input style={{ width: 84 }} inputMode="numeric" value={l.qty} onInput={(e) => set(i, Math.max(0, parseInt(e.currentTarget.value) || 0))} aria-label={t('cart.qty')} />
              <button type="button" class="btn small danger" onClick={() => props.setLines(props.lines.filter((_, j) => j !== i))} aria-label={t('common.remove')}>
                <Icon.x />
              </button>
            </div>
          );
        })}
      </div>
      <ProductPick q={q} setQ={setQ} products={s.products} exclude={new Set(props.lines.map((l) => l.productId))} onPick={(p) => props.setLines([...props.lines, { productId: p.id, qty: 1 }])} />
    </div>
  );
}

export function TransferNewPage(props: { requestId: string | null }) {
  const s = useSession();
  const stock = useStock(s.storeId);
  const req = useLive(() => (props.requestId ? db.transfer_request.get(props.requestId) : Promise.resolve(undefined)) as Promise<TransferRequest | undefined>, [props.requestId], undefined);
  const others = s.stores.filter((x) => x.id !== s.storeId);
  const [to, setTo] = useState<string>('');
  const [lines, setLines] = useState<TransferLine[] | null>(null);
  const [note, setNote] = useState('');
  const dest = to || req?.storeId || others[0]?.id || '';
  const current = lines ?? req?.lines ?? [];
  if (!s.can('transfer.send')) return <Page title={t('transfers.send')} back><Empty>{t('error.forbidden')}</Empty></Page>;

  const submit = async (e: Event) => {
    e.preventDefault();
    const ls = current.filter((l) => l.qty > 0);
    if (!ls.length || !dest) return;
    const doc = await engine.createDoc<TransferSend>('transfer_send', s.user.id, s.storeId, { toStoreId: dest, requestId: req?.id ?? null, lines: ls, note: note || undefined });
    toast(t('transfers.sent'));
    go(`/transfer/${doc.id}`);
  };

  return (
    <Page title={t('transfers.send')} back>
      <form class="stack" onSubmit={submit}>
        {req && <div class="notice">{t('transfers.fromRequest', { store: s.stores.find((x) => x.id === req.storeId)?.name ?? '' })}</div>}
        <Field label={t('transfers.destination')}>
          <select value={dest} onChange={(e) => setTo(e.currentTarget.value)}>
            {others.map((x) => (
              <option value={x.id}>{x.name}</option>
            ))}
          </select>
        </Field>
        <Section title={t('transfers.items')} />
        <LinesEditor lines={current} setLines={setLines} stockLabel={(pid) => t('transfers.here', { n: stock.get(pid) ?? 0 })} />
        <Field label={t('cart.note')}>
          <input value={note} onInput={(e) => setNote(e.currentTarget.value)} />
        </Field>
        <button class="btn primary block" disabled={!current.some((l) => l.qty > 0)}>{t('transfers.confirmSend')}</button>
      </form>
    </Page>
  );
}

export function RequestNewPage(props: { productId: string | null }) {
  const s = useSession();
  const all = useStock(null);
  const others = s.stores.filter((x) => x.id !== s.storeId);
  const [from, setFrom] = useState(others[0]?.id ?? '');
  const [lines, setLines] = useState<TransferLine[]>(props.productId ? [{ productId: props.productId, qty: 1 }] : []);
  const [note, setNote] = useState('');
  const submit = async (e: Event) => {
    e.preventDefault();
    const ls = lines.filter((l) => l.qty > 0);
    if (!ls.length) return;
    const doc = await engine.createDoc<TransferRequest>('transfer_request', s.user.id, s.storeId, { fromStoreId: from, lines: ls, note: note || undefined });
    const fromStore = s.stores.find((x) => x.id === from)!;
    await sendWhatsApp({ kind: 'transfer_request', to: fromStore.phone, text: transferRequestText(t, doc, fromStore, s.store, s.productById) });
    go(`/transfer/${doc.id}`);
  };
  return (
    <Page title={t('transfers.request')} back>
      <form class="stack" onSubmit={submit}>
        <Field label={t('transfers.askStore')}>
          <select value={from} onChange={(e) => setFrom(e.currentTarget.value)}>
            {others.map((x) => (
              <option value={x.id}>{x.name}</option>
            ))}
          </select>
        </Field>
        <Section title={t('transfers.items')} />
        <LinesEditor lines={lines} setLines={setLines} stockLabel={(pid) => t('transfers.there', { n: all.get(`${from}:${pid}`) ?? 0 })} />
        <Field label={t('cart.note')}>
          <input value={note} onInput={(e) => setNote(e.currentTarget.value)} placeholder={t('transfers.notePh')} />
        </Field>
        <button class="btn wa block" disabled={!lines.some((l) => l.qty > 0)}>
          <Icon.whatsapp />
          {t('transfers.sendRequest')}
        </button>
      </form>
    </Page>
  );
}

export function TransferPage(props: { id: string }) {
  const s = useSession();
  const send = useLive(() => db.transfer_send.get(props.id) as Promise<TransferSend | undefined>, [props.id], undefined);
  const req = useLive(() => db.transfer_request.get(props.id) as Promise<TransferRequest | undefined>, [props.id], undefined);
  const recv = useLive(() => db.transfer_receive.get(receiveIdFor(props.id)) as Promise<TransferReceive | undefined>, [props.id], undefined);
  const fulfilled = useLive(() => db.transfer_send.where('requestId').equals(props.id).first() as Promise<TransferSend | undefined>, [props.id], undefined);
  const [got, setGot] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const name = (id: string) => s.stores.find((x) => x.id === id)?.name ?? id;

  if (req) {
    const text = transferRequestText(t, req, s.stores.find((x) => x.id === req.fromStoreId)!, s.stores.find((x) => x.id === req.storeId)!, s.productById);
    return (
      <Page title={t('transfers.requestTitle')} back="/transfers">
        <p><b>{name(req.storeId)}</b> → {name(req.fromStoreId)} · {fmtDateTime(req.at)}</p>
        {req.note && <div class="notice">{req.note}</div>}
        <table class="facts">
          <tbody>
            {req.lines.map((l) => (
              <tr><td>{s.productById.get(l.productId)?.name}<div class="muted">{s.productById.get(l.productId)?.ref}</div></td><td class="n"><span class="qty">{l.qty}</span></td></tr>
            ))}
          </tbody>
        </table>
        <div class="stack" style={{ marginTop: 12 }}>
          {fulfilled ? (
            <a class="btn block" href={`#/transfer/${fulfilled.id}`}>{t('transfers.seeSend')}</a>
          ) : (
            req.fromStoreId === s.storeId && s.can('transfer.send') && <a class="btn primary block" href={`#/transfer/new?request=${req.id}`}>{t('transfers.prepare')}</a>
          )}
          <button class="btn wa block" onClick={() => sendWhatsApp({ kind: 'transfer_request', to: s.stores.find((x) => x.id === req.fromStoreId)?.phone, text })}>
            <Icon.whatsapp />
            {t('transfers.resend')}
          </button>
        </div>
      </Page>
    );
  }
  if (!send) return <Page title={t('transfers.title')} back="/transfers"><Empty>{t('common.notFound')}</Empty></Page>;
  const from = s.stores.find((x) => x.id === send.storeId)!;
  const to = s.stores.find((x) => x.id === send.toStoreId)!;
  const canReceive = !recv && send.toStoreId === s.storeId && s.can('transfer.receive');
  const qtyGot = (pid: string, sent: number) => {
    const v = got[pid];
    return v === undefined ? sent : Math.max(0, parseInt(v) || 0);
  };

  const receive = async (e: Event) => {
    e.preventDefault();
    await engine.createDoc<TransferReceive>('transfer_receive', s.user.id, s.storeId, {
      id: receiveIdFor(send.id),
      sendId: send.id,
      fromStoreId: send.storeId,
      lines: send.lines.map((l) => ({ productId: l.productId, qty: qtyGot(l.productId, l.qty) })),
      note: note || undefined,
    });
    toast(t('transfers.receivedOk'));
  };

  return (
    <Page title={t('transfers.transferTitle')} back="/transfers">
      <p><b>{from?.name}</b> → <b>{to?.name}</b></p>
      <p class="muted">{t('transfers.sentAt', { at: fmtDateTime(send.at), name: s.users.find((u) => u.id === send.userId)?.name ?? '' })}</p>
      {recv ? (
        <div class="notice ok">{t('transfers.receivedAt', { at: fmtDateTime(recv.at), name: s.users.find((u) => u.id === recv.userId)?.name ?? '' })}</div>
      ) : (
        <div class="notice warn">{t('transfers.inTransitLong')}</div>
      )}
      <form onSubmit={receive}>
        <table class="facts" style={{ marginTop: 10 }}>
          <thead>
            <tr><th>{t('reports.product')}</th><th class="n">{t('transfers.sentQty')}</th><th class="n">{t('transfers.gotQty')}</th></tr>
          </thead>
          <tbody>
            {send.lines.map((l) => {
              const r = recv?.lines.find((x) => x.productId === l.productId)?.qty;
              return (
                <tr>
                  <td>{s.productById.get(l.productId)?.name}<div class="muted">{s.productById.get(l.productId)?.ref}</div></td>
                  <td class="n"><span class="qty">{l.qty}</span></td>
                  <td class="n">
                    {canReceive ? (
                      <input style={{ width: 80 }} inputMode="numeric" value={got[l.productId] ?? String(l.qty)} onInput={(e) => setGot({ ...got, [l.productId]: e.currentTarget.value })} aria-label={t('transfers.gotQty')} />
                    ) : r !== undefined ? (
                      <span class={`qty ${r !== l.qty ? 'neg' : ''}`}>{r}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {canReceive && (
          <div class="stack" style={{ marginTop: 12 }}>
            {send.lines.some((l) => qtyGot(l.productId, l.qty) !== l.qty) && <div class="notice bad">{t('transfers.gapWarn')}</div>}
            <Field label={t('cart.note')}>
              <input value={note} onInput={(e) => setNote(e.currentTarget.value)} />
            </Field>
            <button class="btn primary block">{t('transfers.confirmReceive')}</button>
          </div>
        )}
      </form>
      <button class="btn wa block" style={{ marginTop: 12 }} onClick={() => sendWhatsApp({ kind: 'transfer_sent', to: send.storeId === s.storeId ? to?.phone : from?.phone, text: transferSendText(t, send, from, to, s.productById) })}>
        <Icon.whatsapp />
        {t('transfers.shareSend')}
      </button>
    </Page>
  );
}
