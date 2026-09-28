// 本地"已加入房间"记录：非公开目录模型下，房间列表只显示用户主动加入过的房间。
// 加入方式：手动输入房间号、或自己创建了房间（非公开目录模型：房间号不出现在 URL，无法经链接加入）。
// 这样不知道房间号/没链接的人看不到任何房间，避免全局房间目录被枚举。

const JOINED_ROOMS_KEY = 'chat_joined_rooms';
const HIDDEN_ROOMS_KEY = 'chat_hidden_rooms';

/** 读取已加入的房间 ID 列表（SSR/无窗口时返回空数组） */
export function getJoinedRooms(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(JOINED_ROOMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 把一个房间加入本地记录（已存在则不变），返回最新列表 */
export function addJoinedRoom(id: string): string[] {
  const clean = id.trim();
  if (!clean) return getJoinedRooms();
  const list = getJoinedRooms();
  if (!list.includes(clean)) {
    list.push(clean);
    try {
      localStorage.setItem(JOINED_ROOMS_KEY, JSON.stringify(list));
    } catch {
      /* 忽略写入失败（隐私模式等） */
    }
  }
  return list;
}

/** 从本地记录移除一个房间，返回最新列表 */
export function removeJoinedRoom(id: string): string[] {
  const list = getJoinedRooms().filter((x) => x !== id.trim());
  try {
    localStorage.setItem(JOINED_ROOMS_KEY, JSON.stringify(list));
  } catch {
    /* 忽略 */
  }
  return list;
}

/**
 * 服务端「我是成员」的房间集合快照（最近一次 /api/rooms/mine 返回的 room_id 列表）。
 * 用途：支撑「被移出群也同步从侧边栏移除」。只有【曾经出现在服务端成员关系里】的群，
 * 在其从服务端消失时才从本地已加入列表移除；手动输号加入的群从未进入
 * 此集合，因此绝不会被误删——避免非公开目录模型下「本地加入但非服务端成员」的房间被清掉。
 */
const SERVER_ROOMS_KEY = 'chat_server_rooms';

/** 读取最近一次服务端房间快照（SSR/无窗口时返回空数组） */
export function getServerRooms(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SERVER_ROOMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 写入服务端房间快照，返回最新列表（调用方据此做「被移出群」的减法对账） */
export function setServerRooms(ids: string[]): string[] {
  const clean = ids.map((x) => String(x).trim()).filter(Boolean);
  try {
    localStorage.setItem(SERVER_ROOMS_KEY, JSON.stringify(clean));
  } catch {
    /* 忽略写入失败（隐私模式等） */
  }
  return clean;
}

/**
 * "隐藏"房间（仅自己列表不可见，对方仍可见）：持久化到独立 key，
 * 用于私聊「仅从自己列表隐藏」语义——避免对方发来新消息时，实时订阅
 * 把该会话重新加回本地已加入列表而「复活」。
 */
export function getHiddenRooms(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HIDDEN_ROOMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 把一个房间加入隐藏记录，返回最新列表 */
export function addHiddenRoom(id: string): string[] {
  const clean = id.trim();
  if (!clean) return getHiddenRooms();
  const list = getHiddenRooms();
  if (!list.includes(clean)) {
    list.push(clean);
    try {
      localStorage.setItem(HIDDEN_ROOMS_KEY, JSON.stringify(list));
    } catch {
      /* 忽略写入失败（隐私模式等） */
    }
  }
  return list;
}

/**
 * 取消隐藏一个房间（把房间从隐藏集合移除），返回最新列表。
 *
 * 语义：微信式「删除会话」只影响本机列表的显示，不应永久屏蔽该会话。
 * 当对方发来新消息时，会话要能被「复活」——否则房间会一直留在已加入列表里
 * 显示（handleNewDM 会把它重新 addJoinedRoom），却因为被排除在实时订阅之外
 * 而永久收不到消息，且刷新页面也无法恢复。
 */
export function removeHiddenRoom(id: string): string[] {
  const clean = id.trim();
  const list = getHiddenRooms().filter((x) => x !== clean);
  try {
    localStorage.setItem(HIDDEN_ROOMS_KEY, JSON.stringify(list));
  } catch {
    /* 忽略 */
  }
  return list;
}

/**
 * "置顶"会话：持久化到独立 key，列表排序时置顶项永远排在最前。
 * 纯前端本地偏好，不影响对端。
 */
const PINNED_ROOMS_KEY = 'chat_pinned_rooms';

/** 读取已置顶的房间 ID 列表（SSR/无窗口时返回空数组） */
export function getPinnedRooms(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PINNED_ROOMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 把一个房间加入置顶记录（已存在则不变），返回最新列表 */
export function addPinnedRoom(id: string): string[] {
  const clean = id.trim();
  if (!clean) return getPinnedRooms();
  const list = getPinnedRooms();
  if (!list.includes(clean)) {
    list.push(clean);
    try {
      localStorage.setItem(PINNED_ROOMS_KEY, JSON.stringify(list));
    } catch {
      /* 忽略写入失败（隐私模式等） */
    }
  }
  return list;
}

/** 从置顶记录移除一个房间，返回最新列表 */
export function removePinnedRoom(id: string): string[] {
  const list = getPinnedRooms().filter((x) => x !== id.trim());
  try {
    localStorage.setItem(PINNED_ROOMS_KEY, JSON.stringify(list));
  } catch {
    /* 忽略 */
  }
  return list;
}

/** 切换置顶状态，返回最新列表（调用方据此更新内存状态） */
export function togglePinnedRoom(id: string): string[] {
  const clean = id.trim();
  if (!clean) return getPinnedRooms();
  const list = getPinnedRooms();
  return list.includes(clean) ? removePinnedRoom(clean) : addPinnedRoom(clean);
}

/**
 * 最近一次打开的房间（刷新后自动还原到此房间）。
 * 邀请链接(?room=) 已移除，房间号不再出现在 URL，故用独立 key 在本地记住落点。
 */
const LAST_ROOM_KEY = 'chat_last_room';

/** 读取上次打开的房间 ID（SSR/无窗口时返回 null） */
export function getLastRoom(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LAST_ROOM_KEY);
    return raw ? raw : null;
  } catch {
    return null;
  }
}

/** 写入上次打开的房间 ID */
export function setLastRoom(id: string): void {
  try {
    localStorage.setItem(LAST_ROOM_KEY, id);
  } catch {
    /* 忽略写入失败（隐私模式等） */
  }
}
