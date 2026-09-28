'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AdminGate from '@/components/AdminGate';
import { API_CONFIG } from '@/config';
import { supabase } from '@/lib/supabase';
import type { Room, Message } from '@/types';
import { Loader2, LogOut, ShieldCheck, Hash, MessageSquare, ChevronLeft, Trash2, AlertTriangle, Check, RefreshCw, Palette } from 'lucide-react';
import { useBrandTheme } from '@/hooks/useBrandTheme';

const DEFAULT_ROOM_ID = 'default-room';

/**
 * /admin — 管理后台。
 *
 * 鉴权：管理员 = 普通 Supabase Auth 账号 + public.users.role='admin'。
 * 登录后由 middleware 对每个 /api/admin/* 请求做服务端 role 校验，不再依赖 admin_session / ADMIN_PASSWORD。
 * 功能：查看全部房间 + 查看某房间消息 + 删除群聊（单个或批量，均需二次确认）。
 */
export default function AdminPage() {
  // null = 校验中；false = 未登录；true = 已登录
  const [authed, setAuthed] = useState<boolean | null>(null);
  // 进入登录框时的提示（例如「当前账号不是管理员」）
  const [gateNotice, setGateNotice] = useState('');

  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState('');

  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');

  // 单个删除：待确认删除的房间、删除中、错误
  const [pendingDelete, setPendingDelete] = useState<Room | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // 批量删除：选择模式、已选集合、批量确认、删除中、错误
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingBatch, setPendingBatch] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchError, setBatchError] = useState('');

  // 视图切换：房间管理 / 审计日志
  const [view, setView] = useState<'manage' | 'audit'>('manage');

  // 品牌主题（微信绿 / 经典靛蓝），管理页一键切换，全站生效
  const { theme: brandTheme, toggle: toggleBrandTheme } = useBrandTheme();

  // 审计日志
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  // 单条消息删除：待确认的消息、删除中、错误
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<Message | null>(null);
  const [deletingMessage, setDeletingMessage] = useState(false);
  const [deleteMessageError, setDeleteMessageError] = useState('');

  const fetchRooms = useCallback(async () => {
    setRoomsLoading(true);
    setRoomsError('');
    try {
      const res = await fetch(API_CONFIG.ADMIN_ROOMS_ENDPOINT, { credentials: 'same-origin' });
      if (res.status === 401) {
        setAuthed(false);
        setGateNotice('');
        return false;
      }
      // 已登录但非管理员：middleware 返回 403，不应卡在「校验中」无限转圈，
      // 而是退回登录框并给出明确提示。
      if (res.status === 403) {
        setAuthed(false);
        setGateNotice('当前账号不是管理员，请使用管理员账号登录');
        return false;
      }
      const data = await res.json();
      if (data.success && Array.isArray(data.rooms)) {
        setRooms(data.rooms);
        setAuthed(true);
        return true;
      }
      setRoomsError(data.message || '获取房间列表失败');
      return true;
    } catch {
      setRoomsError('网络错误，请稍后重试');
      return true;
    } finally {
      setRoomsLoading(false);
    }
  }, []);

  // 首次进入探测会话
  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  const loadMessages = useCallback(async (room: Room) => {
    setSelectedRoom(room);
    setMessages([]);
    setMessagesLoading(true);
    setMessagesError('');
    try {
      const res = await fetch(
        `${API_CONFIG.ADMIN_MESSAGES_ENDPOINT}?roomId=${encodeURIComponent(room.id)}`,
        { credentials: 'same-origin' }
      );
      if (res.status === 401 || res.status === 403) {
        setAuthed(false);
        if (res.status === 403) setGateNotice('当前账号不是管理员，请使用管理员账号登录');
        return;
      }
      const data = await res.json();
      if (data.success && Array.isArray(data.messages)) {
        setMessages(data.messages);
      } else {
        setMessagesError(data.message || '加载消息失败');
      }
    } catch {
      setMessagesError('网络错误，请稍后重试');
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await supabase?.auth.signOut();
    } catch { /* ignore */ }
    setAuthed(false);
    setRooms([]);
    setSelectedRoom(null);
    setMessages([]);
  }, []);

  const deleteRoom = useCallback(async (roomId: string) => {
    setDeleting(true);
    setDeleteError('');
    try {
      const res = await fetch(API_CONFIG.ADMIN_ROOMS_ENDPOINT, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id: roomId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setRooms((rs) => rs.filter((r) => r.id !== roomId));
        if (selectedRoom?.id === roomId) setSelectedRoom(null);
        setPendingDelete(null);
      } else {
        setDeleteError(data.message || '删除失败');
      }
    } catch {
      setDeleteError('网络错误，请稍后重试');
    } finally {
      setDeleting(false);
    }
  }, [selectedRoom]);

  // ===== 批量删除相关 =====
  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((on) => {
      if (on) setSelectedIds(new Set()); // 退出选择模式清空选择
      return !on;
    });
  }, []);

  const toggleRoomSelected = useCallback((id: string) => {
    if (id === DEFAULT_ROOM_ID) return; // 默认群聊受保护，禁止选择
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const deleteMany = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBatchDeleting(true);
    setBatchError('');
    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(API_CONFIG.ADMIN_ROOMS_ENDPOINT, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ id }),
          }).then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
              throw new Error(data.message || `删除失败：${id}`);
            }
            return id;
          })
        )
      );
      const failed = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected'
      );
      // 删除中若正查看某个被删房间，清空右侧
      if (selectedRoom && ids.includes(selectedRoom.id)) setSelectedRoom(null);
      await fetchRooms(); // 重新拉取，保证列表与服务端一致（失败的仍在）
      setSelectedIds(new Set());
      setPendingBatch(false);
      if (failed.length > 0) {
        setBatchError(`部分删除失败：${failed.map((f) => (f.reason as Error).message).join('；')}`);
      }
    } catch {
      setBatchError('网络错误，请稍后重试');
    } finally {
      setBatchDeleting(false);
    }
  }, [selectedIds, selectedRoom, fetchRooms]);

  // ===== 审计日志 =====
  const fetchAuditLogs = useCallback(async () => {
    setLogsLoading(true);
    setLogsError('');
    try {
      const qs = actionFilter ? `?action=${encodeURIComponent(actionFilter)}` : '';
      const res = await fetch(`${API_CONFIG.ADMIN_AUDIT_LOGS_ENDPOINT}${qs}`, {
        credentials: 'same-origin',
      });
      if (res.status === 401 || res.status === 403) {
        setAuthed(false);
        if (res.status === 403) setGateNotice('当前账号不是管理员，请使用管理员账号登录');
        return;
      }
      const data = await res.json();
      if (data.success && Array.isArray(data.logs)) {
        setLogs(data.logs);
      } else {
        setLogsError(data.message || '获取审计日志失败');
      }
    } catch {
      setLogsError('网络错误，请稍后重试');
    } finally {
      setLogsLoading(false);
    }
  }, [actionFilter]);

  // 进入审计页签时拉取一次
  useEffect(() => {
    if (authed && view === 'audit') {
      fetchAuditLogs();
    }
  }, [authed, view, fetchAuditLogs]);

  const deleteMessage = useCallback(
    async (roomId: string, messageId: string) => {
      setDeletingMessage(true);
      setDeleteMessageError('');
      try {
        const res = await fetch(API_CONFIG.ADMIN_MESSAGES_ENDPOINT, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ roomId, messageId }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          setMessages((ms) => ms.filter((m) => m.id !== messageId));
          setPendingDeleteMessage(null);
        } else {
          setDeleteMessageError(data.message || '删除失败');
        }
      } catch {
        setDeleteMessageError('网络错误，请稍后重试');
      } finally {
        setDeletingMessage(false);
      }
    },
    []
  );

  // ==================== 校验中 ====================
  if (authed === null) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  // ==================== 未登录：管理后台登录框 ====================
  if (!authed) {
    return (
      <AdminGate
        title="管理后台"
        subtitle="请使用管理员账号登录"
        submitLabel="进入后台"
        notice={gateNotice}
        onSuccess={() => { setGateNotice(''); setAuthed(true); fetchRooms(); }}
      />
    );
  }

  const selectedCount = selectedIds.size;

  // ==================== 已登录：总览 + 删除 ====================
  return (
    <div className="fixed inset-0 bg-background flex items-stretch justify-center">
      <div className="flex flex-col h-full w-full max-w-6xl bg-card overflow-hidden relative">
        {/* 顶部页签：房间管理 / 审计日志 */}
        <header className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
          <div className="flex items-center gap-1">
            <TabButton active={view === 'manage'} onClick={() => setView('manage')}>
              房间管理
            </TabButton>
            <TabButton active={view === 'audit'} onClick={() => setView('audit')}>
              审计日志
            </TabButton>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleBrandTheme}
              className="h-9 px-3 rounded-lg flex items-center gap-1.5 text-muted-foreground hover:bg-muted transition-colors text-[13px] font-medium"
              aria-label="切换界面主题"
              title={
                brandTheme === 'classic'
                  ? '当前：经典靛蓝，点击切换为微信绿'
                  : '当前：微信绿，点击切换为经典靛蓝'
              }
            >
              <Palette className="w-4 h-4" />
              {brandTheme === 'classic' ? '经典靛蓝' : '微信绿'}
            </button>
            <button
              onClick={handleLogout}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
              aria-label="退出管理后台"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </header>

        {view === 'audit' ? (
          <AuditPanel
            logs={logs}
            loading={logsLoading}
            error={logsError}
            actionFilter={actionFilter}
            onFilterChange={(v) => setActionFilter(v)}
            onRefresh={fetchAuditLogs}
          />
        ) : (
        <div className="flex flex-1 min-h-0">
        {/* 左侧：房间列表 */}
        <aside
          className={`${selectedRoom ? 'hidden' : 'flex'} lg:flex flex-col lg:w-80 lg:shrink-0 lg:border-r lg:border-border h-full w-full`}
        >
          <header className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <h1 className="text-[17px] font-semibold text-foreground">全部房间</h1>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-medium">
                <ShieldCheck className="w-3 h-3" />
                管理员
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={toggleSelectionMode}
                className="px-2.5 h-9 rounded-lg text-[13px] text-muted-foreground hover:bg-muted transition-colors"
                aria-label={selectionMode ? '退出批量管理' : '批量管理'}
              >
                {selectionMode ? '取消' : '批量管理'}
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            {roomsLoading && rooms.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : roomsError ? (
              <div className="px-4 py-6 text-sm text-destructive">{roomsError}</div>
            ) : rooms.length === 0 ? (
              <div className="px-4 py-16 text-center text-sm text-muted-foreground">暂无房间</div>
            ) : (
              rooms.map((room) => {
                const isDefault = room.id === DEFAULT_ROOM_ID;
                const isSelected = selectedIds.has(room.id);
                if (selectionMode) {
                  return (
                    <div
                      key={room.id}
                      onClick={() => toggleRoomSelected(room.id)}
                      className={`relative w-full flex items-center gap-3 px-4 py-3 text-left border-b border-border/60 hover:bg-muted transition-colors cursor-pointer ${
                        isSelected ? 'bg-primary/10' : ''
                      } ${isDefault ? 'opacity-60' : ''}`}
                    >
                      <span
                        className={`w-5 h-5 rounded-md border shrink-0 flex items-center justify-center transition-colors ${
                          isSelected ? 'bg-primary border-primary text-white' : 'border-muted-foreground/40'
                        }`}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[15px] font-medium text-foreground truncate">{room.name || room.id}</span>
                          {isDefault && (
                            <span className="text-[10px] text-muted-foreground/70 border border-border rounded px-1 shrink-0">
                              受保护
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground/70 mt-0.5 font-mono truncate">
                          ID: {room.id}
                        </div>
                      </div>
                    </div>
                  );
                }
                return (
                  <div
                    key={room.id}
                    onClick={() => loadMessages(room)}
                    className={`relative w-full flex items-start gap-3 px-4 py-3 text-left border-b border-border/60 hover:bg-muted transition-colors cursor-pointer ${
                      selectedRoom?.id === room.id ? 'bg-muted' : ''
                    }`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Hash className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0 pr-8">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[15px] font-medium text-foreground truncate">{room.name || room.id}</span>
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          {formatShort(room.last_message_at)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <span className="text-[13px] text-muted-foreground truncate">
                          {summarize(room)}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground/70 mt-0.5 font-mono truncate">
                        ID: {room.id}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDelete(room);
                      }}
                      className="absolute top-2 right-2 w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      aria-label={`删除群聊 ${room.name || room.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* 批量操作栏 */}
          {selectionMode && (
            <div className="shrink-0 border-t border-border px-4 h-14 flex items-center justify-between gap-2 bg-card">
              <span className="text-[13px] text-muted-foreground">已选 {selectedCount} 个</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedIds(
                      new Set(rooms.filter((r) => r.id !== DEFAULT_ROOM_ID).map((r) => r.id))
                    )
                  }
                  className="px-2.5 h-9 rounded-lg text-[13px] text-muted-foreground hover:bg-muted transition-colors"
                >
                  全选
                </button>
                <button
                  type="button"
                  disabled={selectedCount === 0}
                  onClick={() => setPendingBatch(true)}
                  className="px-3 h-9 rounded-lg text-[13px] font-medium bg-destructive text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  <Trash2 className="w-4 h-4" />
                  删除选中{selectedCount > 0 ? ` (${selectedCount})` : ''}
                </button>
              </div>
            </div>
          )}
        </aside>

        {/* 右侧：消息只读视图 */}
        <section
          className={`${selectedRoom ? 'flex' : 'hidden'} lg:flex flex-col flex-1 h-full min-w-0 w-full`}
        >
          {selectedRoom ? (
            <>
              <header className="flex items-center gap-2 px-3 h-14 border-b border-border shrink-0">
                <button
                  onClick={() => setSelectedRoom(null)}
                  className="lg:hidden w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
                  aria-label="返回"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-foreground truncate">
                    {selectedRoom.name || selectedRoom.id}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono truncate">
                    ID: {selectedRoom.id} · 创建者 {selectedRoom.created_by || '未知'}
                  </div>
                </div>
              </header>

              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {messagesLoading ? (
                  <div className="flex items-center justify-center py-16 text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                ) : messagesError ? (
                  <div className="text-sm text-destructive">{messagesError}</div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground py-16">该房间暂无消息</div>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className="relative flex flex-col gap-0.5 group">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[13px] font-medium text-foreground">{m.user}</span>
                        <span className="text-[11px] text-muted-foreground">{formatFull(m.timestamp)}</span>
                        {m.edited_at && <span className="text-[11px] text-muted-foreground">(已编辑)</span>}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDeleteMessage(m);
                          }}
                          className="ml-auto w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                          aria-label={`删除消息`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="text-[14px] text-foreground/90 bg-muted/50 rounded-xl px-3 py-2 max-w-[80%] break-words whitespace-pre-wrap">
                        {renderContent(m)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="hidden lg:flex flex-1 items-center justify-center text-muted-foreground">
              <div className="flex flex-col items-center gap-3">
                <MessageSquare className="w-10 h-10 opacity-40" />
                <span className="text-sm">选择左侧房间查看消息</span>
              </div>
            </div>
          )}
        </section>
        </div>
        )}
      </div>

      {/* 单删确认弹窗 */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => { if (!deleting) setPendingDelete(null); }}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              <h3 className="text-[15px] font-semibold text-foreground">删除群聊</h3>
            </div>
            <p className="text-sm text-foreground/90">
              确定删除「{pendingDelete.name || pendingDelete.id}」吗？
            </p>
            <p className="text-xs text-destructive/80 mt-1">
              该群聊及其所有消息将被永久删除，不可恢复。
            </p>
            {deleteError && <p className="text-sm text-destructive mt-3">{deleteError}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
                className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => deleteRoom(pendingDelete.id)}
                disabled={deleting}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-destructive text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {deleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量删除确认弹窗 */}
      {pendingBatch && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => { if (!batchDeleting) setPendingBatch(false); }}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              <h3 className="text-[15px] font-semibold text-foreground">批量删除群聊</h3>
            </div>
            <p className="text-sm text-foreground/90">
              确定删除选中的 {selectedCount} 个群聊吗？
            </p>
            <p className="text-xs text-destructive/80 mt-1">
              这些群聊及其所有消息将被永久删除，不可恢复。
            </p>
            {batchError && <p className="text-sm text-destructive mt-3">{batchError}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => { setPendingBatch(false); setBatchError(''); }}
                disabled={batchDeleting}
                className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={deleteMany}
                disabled={batchDeleting}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-destructive text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {batchDeleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 单条消息删除确认弹窗 */}
      {pendingDeleteMessage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => { if (!deletingMessage) setPendingDeleteMessage(null); }}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              <h3 className="text-[15px] font-semibold text-foreground">删除消息</h3>
            </div>
            <p className="text-sm text-foreground/90">
              确定删除 {pendingDeleteMessage.user} 发送的这条消息吗？
            </p>
            <div className="mt-2 max-h-28 overflow-y-auto text-[13px] text-muted-foreground bg-muted/50 rounded-lg px-3 py-2 break-words whitespace-pre-wrap">
              {pendingDeleteMessage.type === 'text'
                ? pendingDeleteMessage.content
                : `[${pendingDeleteMessage.type}${pendingDeleteMessage.file_name ? ` · ${pendingDeleteMessage.file_name}` : ''}]`}
            </div>
            <p className="text-xs text-destructive/80 mt-1">该消息将被永久删除，不可恢复，且会记入审计日志。</p>
            {deleteMessageError && <p className="text-sm text-destructive mt-3">{deleteMessageError}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setPendingDeleteMessage(null)}
                disabled={deletingMessage}
                className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => deleteMessage(selectedRoom?.id || '', pendingDeleteMessage.id)}
                disabled={deletingMessage || !selectedRoom}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-destructive text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {deletingMessage ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== 辅助函数 ====================

interface AuditLog {
  id: number;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown> | null;
  admin_ip: string | null;
  created_at: string;
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  delete_room: '删除群聊',
  delete_room_failed: '删除群聊失败',
  delete_message: '删除消息',
  delete_message_failed: '删除消息失败',
};

const AUDIT_ACTION_OPTIONS = [
  { value: '', label: '全部操作' },
  { value: 'delete_room', label: '删除群聊' },
  { value: 'delete_room_failed', label: '删除群聊失败' },
  { value: 'delete_message', label: '删除消息' },
  { value: 'delete_message_failed', label: '删除消息失败' },
];

function AuditPanel({
  logs,
  loading,
  error,
  actionFilter,
  onFilterChange,
  onRefresh,
}: {
  logs: AuditLog[];
  loading: boolean;
  error: string;
  actionFilter: string;
  onFilterChange: (v: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-between gap-2 px-4 h-12 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <span className="text-[14px] font-medium text-foreground">操作审计日志</span>
          <span className="text-[11px] text-muted-foreground">仅管理员可见</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={actionFilter}
            onChange={(e) => onFilterChange(e.target.value)}
            className="h-8 rounded-lg border border-border bg-background px-2 text-[13px] text-foreground focus:outline-none"
          >
            {AUDIT_ACTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            onClick={onRefresh}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
            aria-label="刷新审计日志"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : error ? (
          <div className="px-4 py-6 text-sm text-destructive">{error}</div>
        ) : logs.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-muted-foreground">暂无审计记录</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-card border-b border-border text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-2 whitespace-nowrap">时间</th>
                <th className="text-left font-medium px-4 py-2 whitespace-nowrap">操作</th>
                <th className="text-left font-medium px-4 py-2 whitespace-nowrap">目标</th>
                <th className="text-left font-medium px-4 py-2 whitespace-nowrap">管理员IP</th>
                <th className="text-left font-medium px-4 py-2">详情</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-border/50 align-top hover:bg-muted/40">
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                    {formatFull(log.created_at)}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${
                        log.action.endsWith('_failed')
                          ? 'bg-destructive/10 text-destructive'
                          : 'bg-primary/10 text-primary'
                      }`}
                    >
                      {AUDIT_ACTION_LABELS[log.action] || log.action}
                    </span>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span className="text-foreground/80">{log.target_type}</span>
                    {log.target_id && (
                      <div className="text-[11px] text-muted-foreground font-mono truncate max-w-[160px]">
                        {log.target_id}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground font-mono text-[12px]">
                    {log.admin_ip || '—'}
                  </td>
                  <td className="px-4 py-2">
                    {log.details ? (
                      <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap break-words max-w-[280px]">
                        {JSON.stringify(log.details)}
                      </pre>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 h-9 rounded-lg text-[13px] font-medium transition-colors ${
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
      }`}
    >
      {children}
    </button>
  );
}

function summarize(room: Room): string {
  if (!room.last_message_at) return '暂无消息';
  const t = room.last_message_type;
  if (t && t !== 'text') {
    const label = t === 'image' ? '图片' : t === 'video' ? '视频' : t === 'voice' ? '语音' : '文件';
    return `${room.last_message_user || ''}: [${label}]`;
  }
  return `${room.last_message_user || ''}: ${room.last_message_content || ''}`;
}

function renderContent(m: Message): React.ReactNode {
  if (m.type === 'text') return m.content;
  const label = m.type === 'image' ? '图片' : m.type === 'video' ? '视频' : m.type === 'voice' ? '语音' : '文件';
  const href = m.content?.startsWith('http') ? m.content : undefined;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-muted-foreground">[{label}{m.file_name ? ` · ${m.file_name}` : ''}]</span>
      {href && (
        <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">
          打开
        </a>
      )}
    </span>
  );
}

function formatShort(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function formatFull(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
