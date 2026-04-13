/**
 * 临时 Token 模块
 *
 * 对标 Sa-Token 的 SaTempTokenUtil，用于生成短时有效的一次性授权 token，
 * 适合文件下载、短链鉴权等场景。
 */

import { generateToken, nowSec } from '../config.js';
import {
  saveTempToken,
  getTempToken,
  deleteTempToken,
} from '../dao/D1Dao.js';
import type { Env } from '../types.js';

export class SaTempToken {
  /**
   * 创建一个临时 token
   * @param env      Worker 环境
   * @param service  业务标识（如 'download'）
   * @param value    要绑定的业务值（如文件路径）
   * @param timeout  有效期（秒）
   */
  async create(env: Env, service: string, value: string, timeout: number): Promise<string> {
    const token = generateToken('temp', service, 'random-64');
    const now = nowSec();
    const expireTime = timeout === -1 ? now + 86400 * 365 * 100 : now + timeout; // -1 近似永久
    await saveTempToken(env.DB, token, service, value, expireTime);
    return token;
  }

  /**
   * 解析临时 token，返回绑定的业务值；token 无效或已过期时返回 null
   */
  async parse(env: Env, token: string): Promise<string | null> {
    const row = await getTempToken(env.DB, token);
    return row?.value ?? null;
  }

  /**
   * 解析临时 token，并校验 service 是否匹配；不匹配返回 null
   */
  async parseByService(env: Env, token: string, service: string): Promise<string | null> {
    const row = await getTempToken(env.DB, token);
    if (!row || row.service !== service) return null;
    return row.value;
  }

  /**
   * 删除临时 token
   */
  async delete(env: Env, token: string): Promise<void> {
    await deleteTempToken(env.DB, token);
  }
}

export const SaTempTokenUtil = new SaTempToken();
