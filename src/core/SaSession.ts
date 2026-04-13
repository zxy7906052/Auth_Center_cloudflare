/**
 * SaSession — 账号级 Session 操作封装
 *
 * 对应 Sa-Token Java 版中的 SaSession 类。
 * Session 数据存储在 D1 的 sa_session_data 表中。
 */

import {
  setSessionData,
  getSessionData,
  getAllSessionData,
  deleteAllSessionData,
} from '../dao/D1Dao.js';
import type { Env } from '../types.js';

export class SaSession {
  loginType: string;
  loginId: string;
  private env: Env;

  constructor(env: Env, loginType: string, loginId: string) {
    this.env = env;
    this.loginType = loginType;
    this.loginId = loginId;
  }

  /** 存储 key-value */
  async set(key: string, value: unknown): Promise<void> {
    await setSessionData(this.env.DB, this.loginType, this.loginId, key, value);
  }

  /** 获取 value，不存在返回 null */
  async get(key: string): Promise<unknown> {
    return getSessionData(this.env.DB, this.loginType, this.loginId, key);
  }

  /** 获取 value，并转换为指定类型 */
  async getAs<T>(key: string): Promise<T | null> {
    const v = await this.get(key);
    return v as T | null;
  }

  /** 获取 value，不存在时返回 defaultValue */
  async getOrDefault<T>(key: string, defaultValue: T): Promise<T> {
    const v = await this.get(key);
    return v !== null && v !== undefined ? (v as T) : defaultValue;
  }

  /** 删除 key */
  async delete(key: string): Promise<void> {
    await setSessionData(this.env.DB, this.loginType, this.loginId, key, null);
  }

  /** 获取所有 key-value */
  async getAll(): Promise<Record<string, unknown>> {
    return getAllSessionData(this.env.DB, this.loginType, this.loginId);
  }

  /** 清空此 Session 的所有数据 */
  async clear(): Promise<void> {
    await deleteAllSessionData(this.env.DB, this.loginType, this.loginId);
  }
}

/**
 * 获取指定账号的 Session 对象
 */
export function getSession(env: Env, loginType: string, loginId: string): SaSession {
  return new SaSession(env, loginType, loginId);
}
