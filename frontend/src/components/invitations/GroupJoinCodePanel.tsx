import { useEffect, useState } from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { ApiError } from '../../lib/apiClient';
import { disableGroupJoinCode, getGroupJoinCode, rotateGroupJoinCode } from '../../lib/invitation.api';

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Đã có lỗi xảy ra. Vui lòng thử lại.';
}

/**
 * Teams-style group code for managers: one persistent, reusable code per group that can be
 * shown again at any time, replaced, or switched off. Recipients type it into
 * "Tham gia nhóm" (JoinByCodeModal), the same box as single-use invitation codes.
 */
export function GroupJoinCodePanel({ groupId }: { groupId: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getGroupJoinCode(groupId)
      .then(info => { if (!cancelled) setCode(info.code); })
      .catch(err => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [groupId]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await action(); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };

  const create = () => run(async () => { setCode((await rotateGroupJoinCode(groupId)).code); setCopied(false); });
  const rotate = () => {
    if (!window.confirm('Đổi sang mã mới? Mã hiện tại sẽ ngừng hoạt động ngay.')) return;
    void create();
  };
  const disable = () => {
    if (!window.confirm('Tắt mã nhóm? Không ai có thể tham gia bằng mã cho tới khi bạn tạo mã mới.')) return;
    void run(async () => { await disableGroupJoinCode(groupId); setCode(null); });
  };
  const copy = () => {
    if (!code) return;
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const secondaryButton: React.CSSProperties = {
    flex: 1, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer', background: 'white',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 16 }}>
      {error && <div role="alert" style={{ color: '#EF4444', fontSize: 13 }}>{error}</div>}
      {loading && <div style={{ color: '#64748B', fontSize: 13 }}>Đang tải...</div>}

      {!loading && code && (
        <>
          <div style={{ fontSize: 13, color: '#334155' }}>Mã nhóm</div>
          <div
            aria-label="Mã nhóm"
            style={{
              padding: '18px 12px', background: '#F8FAFC', border: '1px dashed #94A3B8', borderRadius: 10,
              textAlign: 'center', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
              fontSize: 30, fontWeight: 700, letterSpacing: 6, color: '#0F172A', userSelect: 'all',
            }}
          >
            {code}
          </div>
          <div style={{ fontSize: 12, color: '#64748B', lineHeight: 1.5 }}>
            Ai có mã này đều có thể vào nhóm. Mã không hết hạn và dùng được nhiều lần. Người được mời vào
            <b> Nhóm học → Tham gia nhóm</b> rồi nhập mã.
          </div>
          <button
            onClick={copy}
            style={{ height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: 'none', borderRadius: 8, background: '#00236F', color: 'white', fontWeight: 600, cursor: 'pointer' }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Đã sao chép' : 'Sao chép mã'}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={rotate} disabled={busy} style={{ ...secondaryButton, color: '#00236F', border: '1px solid #CBD5E1' }}>
              <RefreshCw size={15} /> Đổi mã
            </button>
            <button onClick={disable} disabled={busy} style={{ ...secondaryButton, color: '#DC2626', border: '1px solid #FECACA' }}>
              Tắt mã
            </button>
          </div>
        </>
      )}

      {!loading && !code && !error && (
        <>
          <div style={{ fontSize: 13, color: '#64748B', lineHeight: 1.5 }}>
            Nhóm chưa có mã. Tạo một mã nhóm cố định để chia sẻ — ai có mã đều có thể tham gia, bạn có thể đổi hoặc tắt bất cứ lúc nào.
          </div>
          <button
            onClick={() => void create()}
            disabled={busy}
            style={{ height: 42, border: 'none', borderRadius: 8, background: busy ? '#94A3B8' : '#00236F', color: 'white', fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}
          >
            {busy ? 'Đang tạo...' : 'Tạo mã nhóm'}
          </button>
        </>
      )}
    </div>
  );
}
