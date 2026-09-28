'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Camera, LogOut, Loader2, Check } from 'lucide-react';
import Avatar from './Avatar';
import { UserProfile } from '@/types';
import { showError, showSuccess } from '@/utils/errorHandler';

interface MePageProps {
  /** 展示名（身份是 UUID，这里只用于展示） */
  currentUser: string;
  profile: UserProfile | null;
  friendCount: number;
  groupCount: number;
  onSaveProfile: (patch: { avatar?: string | null; signature?: string; display_name?: string }) => Promise<UserProfile | null>;
  onLogout: () => void;
}

const MePage: React.FC<MePageProps> = ({
  currentUser,
  profile,
  friendCount,
  groupCount,
  onSaveProfile,
  onLogout,
}) => {
  const [editingSig, setEditingSig] = useState(false);
  const [sigDraft, setSigDraft] = useState(profile?.signature || '');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(profile?.display_name || currentUser);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handlePickAvatar = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showError('请选择图片文件');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showError('头像不能超过 5MB');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('roomId', 'avatars');
      const res = await fetch('/api/upload-media', { method: 'POST', body: fd });
      const json = await res.json();
      if (!json.success || !json.filePath) {
        showError(json.message || '头像上传失败');
        return;
      }
      const saved = await onSaveProfile({ avatar: json.filePath });
      if (saved) showSuccess('头像已更新');
      else showError('头像保存失败');
    } catch {
      showError('头像上传失败');
    } finally {
      setUploading(false);
    }
  }, [onSaveProfile]);

  const handleSaveSig = useCallback(async () => {
    setSaving(true);
    try {
      const saved = await onSaveProfile({ signature: sigDraft.trim().slice(0, 60) });
      if (saved) {
        setEditingSig(false);
        showSuccess('签名已更新');
      } else {
        showError('保存失败');
      }
    } finally {
      setSaving(false);
    }
  }, [sigDraft, onSaveProfile]);

  /** 修改展示名：身份（UUID）不变，只是换一个聊天里显示的名字 */
  const handleSaveName = useCallback(async () => {
    const next = nameDraft.trim();
    if (!next) {
      showError('昵称不能为空');
      return;
    }
    if (next.length > 20) {
      showError('昵称不能超过 20 个字');
      return;
    }
    if (next === (profile?.display_name || currentUser)) {
      setEditingName(false);
      return;
    }
    setSaving(true);
    try {
      const saved = await onSaveProfile({ display_name: next });
      if (saved) {
        setEditingName(false);
        showSuccess('昵称已更新');
      } else {
        showError('保存失败');
      }
    } finally {
      setSaving(false);
    }
  }, [nameDraft, profile?.display_name, currentUser, onSaveProfile]);

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto">
      {/* 资料卡 */}
      <div className="bg-card px-5 py-6 border-b border-border">
        <div className="flex items-center gap-4">
          <button
            onClick={() => fileRef.current?.click()}
            className="relative group flex-shrink-0"
            aria-label="更换头像"
          >
            <Avatar name={currentUser} avatar={profile?.avatar} size={64} rounded="xl" />
            <span className="absolute inset-0 rounded-[14px] bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              {uploading ? (
                <Loader2 className="w-5 h-5 text-white animate-spin" />
              ) : (
                <Camera className="w-5 h-5 text-white" />
              )}
            </span>
            {uploading && (
              <span className="absolute inset-0 rounded-[14px] bg-black/45 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-white animate-spin" />
              </span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePickAvatar}
          />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {editingName ? (
                <div className="flex items-center gap-1.5 min-w-0">
                  <input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveName();
                      if (e.key === 'Escape') { setNameDraft(profile?.display_name || currentUser); setEditingName(false); }
                    }}
                    maxLength={20}
                    autoFocus
                    placeholder="你的昵称"
                    className="min-w-0 w-full h-9 px-2 text-[15px] font-semibold rounded-lg border border-input bg-background text-foreground outline-none focus:border-primary"
                  />
                  <button
                    onClick={handleSaveName}
                    disabled={saving}
                    className="p-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50 flex-shrink-0"
                    aria-label="保存昵称"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setNameDraft(profile?.display_name || currentUser); setEditingName(true); }}
                  className="min-w-0 text-left"
                  aria-label="修改昵称"
                >
                  <h2 className="text-xl font-semibold text-foreground truncate hover:text-primary transition-colors">
                    {profile?.display_name || currentUser}
                  </h2>
                </button>
              )}
            </div>

            {editingSig ? (
              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  value={sigDraft}
                  onChange={(e) => setSigDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveSig();
                    if (e.key === 'Escape') { setSigDraft(profile?.signature || ''); setEditingSig(false); }
                  }}
                  maxLength={60}
                  autoFocus
                  placeholder="写点什么介绍自己"
                  className="flex-1 min-w-0 h-8 px-2 text-[13px] rounded-lg border border-input bg-background text-foreground outline-none focus:border-primary"
                />
                <button
                  onClick={handleSaveSig}
                  disabled={saving}
                  className="p-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
                  aria-label="保存签名"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setSigDraft(profile?.signature || ''); setEditingSig(true); }}
                className="mt-1 text-[13px] text-muted-foreground hover:text-foreground transition-colors text-left truncate max-w-full"
              >
                {profile?.signature || '点击设置个性签名'}
              </button>
            )}
          </div>
        </div>

        {/* 统计 */}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-muted/50 py-2.5 text-center">
            <div className="text-lg font-semibold text-foreground">{friendCount}</div>
            <div className="text-[11px] text-muted-foreground">好友</div>
          </div>
          <div className="rounded-xl bg-muted/50 py-2.5 text-center">
            <div className="text-lg font-semibold text-foreground">{groupCount}</div>
            <div className="text-[11px] text-muted-foreground">群聊</div>
          </div>
        </div>
      </div>

      {/* 设置项 */}
      <div className="mt-3 bg-card border-y border-border">
        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 px-5 py-3.5 text-destructive hover:bg-destructive/10 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span className="text-[15px] font-medium">退出登录</span>
        </button>
      </div>

    </div>
  );
};

export default MePage;
