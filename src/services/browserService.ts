import { fetchJson, HttpError } from '../utils/http';
import { logger } from '../utils/logger';

export interface WorkspaceFileContent {
  path: string;
  lang: string;
  content: string;
}

export const browserService = {
  /**
   * List read-only project source files for Developer Code tab inspection
   */
  async listWorkspaceFiles(): Promise<string[]> {
    try {
      const data = await fetchJson<{ files?: string[] }>('/api/workspace/files', {
        timeoutMs: 10_000,
      });
      return Array.isArray(data?.files) ? data.files : [];
    } catch (error) {
      // Non-JSON 200s (SPA fallback) and offline runtimes both land here.
      logger.debug('Workspace file listing unavailable', error);
      return [];
    }
  },

  /**
   * Read a specific workspace file safely inside project root
   */
  async readWorkspaceFile(filePath: string): Promise<WorkspaceFileContent> {
    try {
      return await fetchJson<WorkspaceFileContent>(
        `/api/workspace/file?path=${encodeURIComponent(filePath)}`,
        { timeoutMs: 10_000 }
      );
    } catch (error) {
      if (error instanceof HttpError && error.status !== 0) {
        throw new Error(
          (error.body as { error?: string } | undefined)?.error || `HTTP ${error.status}`,
          { cause: error }
        );
      }
      throw new Error('Workspace file reader requires the local Node backend.', { cause: error });
    }
  },
};
