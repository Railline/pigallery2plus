import {Config} from '../../../common/config/private/Config';
import {ExtensionListItem} from '../../../common/entities/extension/ExtensionListItem';

export class ExtensionRepository {

  extensionsList: ExtensionListItem[];
  lastUpdate = 0;
  private readonly UPDATE_FREQUENCY_MS = 30 * 1000;
  private readonly MAX_REPOSITORY_BYTES = 2 * 1024 * 1024;

  public async getExtensionList(): Promise<ExtensionListItem[]> {
    if (this.lastUpdate < Date.now() - this.UPDATE_FREQUENCY_MS) {
      await this.fetchList();
    }

    return this.extensionsList;
  }

  private getUrlFromMDLink(text: string): string | undefined {
    if (!text) {
      return text;
    }
    text = ('' + text).trim();
    const markdownLink = /^\[[^\]]*]\((https?:\/\/[^\s)]+)\)$/i.exec(text);
    const candidate = markdownLink?.[1] || text;
    try {
      const parsed = new URL(candidate);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : undefined;
    } catch {
      return undefined;
    }
  }

  public repoMD(text: string): ExtensionListItem[] {
    const lines = text.split('\n');
    lines.forEach(line => line.trim());
    const tableStartLine = lines.findIndex(l => l.startsWith('|     **Name**     |'));
    if (tableStartLine < 0) {
      return [];
    }
    const tableHeaderLines = 2;
    const table = lines.slice(tableStartLine + tableHeaderLines);
    const extensions: ExtensionListItem[] = [];
    const getUniqueID = (name: string) => {
      let id = name;
      let i = 2;
      while (extensions.findIndex(e => e.id === id) !== -1) {
        id = name + '-' + i;
        ++i;
      }
      return id;
    };
    table.slice(0, 256).forEach(l => {
      const entries = l.split('|').map((l) => l.trim()).filter(e => !!e);
      if (entries.length < 4) {
        return;
      }

      extensions.push({
        id: getUniqueID(entries[0].toLowerCase().replace(/\s+/g, '-')),
        name: entries[0],
        url: this.getUrlFromMDLink(entries[1]),
        readme: this.getUrlFromMDLink(entries[2]),
        zipUrl: this.getUrlFromMDLink(entries[3])
      });
    });
    return extensions;
  }

  public async fetchList(): Promise<ExtensionListItem[]> {
    const repositoryUrl = new URL(Config.Extensions.repositoryUrl);
    if (repositoryUrl.protocol !== 'https:') {
      throw new Error('The extension repository must use HTTPS');
    }
    const response = await fetch(repositoryUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok || !response.body) {
      throw new Error(`Could not download extension repository: HTTP ${response.status}`);
    }
    if (new URL(response.url).protocol !== 'https:') {
      throw new Error('The extension repository redirected to an insecure URL');
    }
    const advertisedSize = Number(response.headers.get('content-length') || 0);
    if (advertisedSize > this.MAX_REPOSITORY_BYTES) {
      throw new Error('The extension repository is too large');
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) {
        break;
      }
      bytes += value.byteLength;
      if (bytes > this.MAX_REPOSITORY_BYTES) {
        await reader.cancel();
        throw new Error('The extension repository is too large');
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8');
    this.extensionsList = this.repoMD(text);
    this.lastUpdate = new Date().getTime();
    return this.extensionsList;
  }
}
