/**
 * PKG-15.2: Moderation Center — hàng đợi báo cáo cho admin.
 * Backend chặn 403 nếu non-admin; view ẩn với người thường.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { ShieldAlert, RefreshCw, CheckCircle2, Trash2, UserX, MessageSquareOff } from 'lucide-react';
import { usePulse } from '../context/PulseContext';
import { api } from '../api/PulseApiClient';

interface ReportItem {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  details: string | null;
  status: string;
  autoScore: number;
  autoLabels: string[];
  actionTaken: string | null;
  createdAt: string;
  reporter?: { id?: string | null; username?: string } | null;
}

const STATUS_FILTERS = ['PENDING', 'RESOLVED', 'DISMISSED'] as const;

export const ModerationCenterView: React.FC = () => {
  const { currentUser } = usePulse();
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('PENDING');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.listAdminReports({ status: statusFilter, limit: 100 });
      setReports((data.reports as unknown as ReportItem[]) || []);
    } catch (err: any) {
      setError(err?.message || 'Không thể tải hàng đợi báo cáo');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    if (currentUser?.isAdmin) fetchReports();
  }, [fetchReports, currentUser?.isAdmin]);

  const handleResolve = async (reportId: string, action: string) => {
    setResolvingId(reportId);
    try {
      await api.resolveAdminReport(reportId, action as 'DISMISS' | 'DELETE_POST' | 'SUSPEND_USER' | 'WARN_USER');
      setReports((prev) => prev.filter((r) => r.id !== reportId));
    } catch (err: any) {
      // lỗi hiển thị qua refetch
      fetchReports();
    } finally {
      setResolvingId(null);
    }
  };

  if (!currentUser?.isAdmin) {
    return (
      <div className="max-w-feed mx-auto pt-8 px-4 text-center" data-testid="moderation-view">
        <p className="text-graphite text-[14px]">Chỉ quản trị viên mới truy cập được trang này.</p>
      </div>
    );
  }

  return (
    <div className="max-w-feed mx-auto pt-8 px-4 pb-24" data-testid="moderation-view">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-[22px] font-bold text-ink flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-meta" />
          Trung tâm kiểm duyệt
        </h1>
        <button
          onClick={fetchReports}
          className="p-2 rounded-full text-ash hover:text-ink hover:bg-mist transition-colors"
          aria-label="Làm mới"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      <div className="flex gap-2 mb-4" role="tablist">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={statusFilter === s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-[13px] font-semibold transition-colors ${
              statusFilter === s ? 'bg-ink text-paper' : 'text-graphite hover:bg-mist'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-20 bg-mist rounded-[14px]" />
          <div className="h-20 bg-mist rounded-[14px]" />
        </div>
      ) : error ? (
        <p className="text-graphite text-[13px] text-center py-10">{error}</p>
      ) : reports.length === 0 ? (
        <p className="text-graphite text-[13px] text-center py-10">
          Không có báo cáo nào ở trạng thái {statusFilter}.
        </p>
      ) : (
        <div className="space-y-3" data-testid="moderation-queue">
          {reports.map((r) => (
            <div key={r.id} className="border border-cloud rounded-[14px] p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className="px-2 py-0.5 rounded-full text-[11px] font-bold text-paper bg-meta"
                    data-testid="report-score"
                  >
                    {r.autoScore}
                  </span>
                  <span className="text-[13px] font-semibold text-ink">
                    {r.targetType} · {r.reason}
                  </span>
                </div>
                <span className="text-[11px] text-ash">
                  {r.reporter?.username ? `@${r.reporter.username}` : 'Tự động phát hiện'}
                </span>
              </div>

              {r.details && <p className="text-[13px] text-graphite mb-2">{r.details}</p>}
              {r.autoLabels.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {r.autoLabels.map((label) => (
                    <span key={label} className="px-1.5 py-0.5 bg-mist text-graphite text-[11px] rounded-full">
                      {label}
                    </span>
                  ))}
                </div>
              )}

              {r.status === 'PENDING' && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleResolve(r.id, 'DISMISS')}
                    disabled={resolvingId === r.id}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-full border border-cloud text-[12px] font-semibold text-ink hover:bg-mist disabled:opacity-50"
                    data-testid="resolve-dismiss"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Bỏ qua
                  </button>
                  {r.targetType === 'POST' && (
                    <button
                      onClick={() => handleResolve(r.id, 'DELETE_POST')}
                      disabled={resolvingId === r.id}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-ink text-paper text-[12px] font-semibold hover:bg-ink/85 disabled:opacity-50"
                      data-testid="resolve-delete-post"
                    >
                      <MessageSquareOff className="w-3.5 h-3.5" /> Gỡ bài viết
                    </button>
                  )}
                  <button
                    onClick={() => handleResolve(r.id, 'SUSPEND_USER')}
                    disabled={resolvingId === r.id}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#dc2626] text-paper text-[12px] font-semibold hover:opacity-85 disabled:opacity-50"
                    data-testid="resolve-suspend"
                  >
                    <UserX className="w-3.5 h-3.5" /> Đình chỉ
                  </button>
                  <button
                    onClick={() => handleResolve(r.id, 'WARN_USER')}
                    disabled={resolvingId === r.id}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-full border border-cloud text-[12px] font-semibold text-ink hover:bg-mist disabled:opacity-50"
                    data-testid="resolve-warn"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Cảnh cáo
                  </button>
                </div>
              )}
              {r.actionTaken && (
                <p className="text-[12px] text-graphite mt-2">Đã xử lý: {r.actionTaken}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
