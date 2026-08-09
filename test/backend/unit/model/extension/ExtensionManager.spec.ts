import {expect} from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import AdmZip = require('adm-zip');
import {ExtensionManager} from '../../../../../src/backend/model/extension/ExtensionManager';
import {ProjectPath} from '../../../../../src/backend/ProjectPath';

declare const describe: any;
declare const it: any;
declare const beforeEach: any;
declare const afterEach: any;

describe('ExtensionManager archive extraction', () => {
  const testRoot = path.join(__dirname, 'tmp_extension_manager');
  let originalExtensionFolder: string;

  beforeEach(() => {
    originalExtensionFolder = ProjectPath.ExtensionFolder;
    ProjectPath.ExtensionFolder = testRoot;
    fs.mkdirSync(testRoot, {recursive: true});
  });

  afterEach(() => {
    ProjectPath.ExtensionFolder = originalExtensionFolder;
    fs.rmSync(testRoot, {recursive: true, force: true});
  });

  it('should safely flatten a single wrapper directory', async () => {
    const zipPath = path.join(testRoot, 'valid.zip');
    const outputPath = path.join(testRoot, 'output');
    const zip = new AdmZip();
    zip.addFile('wrapper/server.js', Buffer.from('module.exports = {};'));
    zip.writeZip(zipPath);

    await (new ExtensionManager() as any).unzipFile(zipPath, outputPath);

    expect(fs.readFileSync(path.join(outputPath, 'server.js'), 'utf8'))
      .to.equal('module.exports = {};');
    expect(fs.existsSync(path.join(outputPath, '__temp_unzip'))).to.be.false;
  });

  it('should reject path traversal entries and clean temporary output', async () => {
    const zipPath = path.join(testRoot, 'traversal.zip');
    const outputPath = path.join(testRoot, 'output');
    const zip = new AdmZip();
    zip.addFile('safe.txt', Buffer.from('unsafe'));
    zip.getEntries()[0].entryName = '../outside.txt';
    zip.writeZip(zipPath);

    let error: Error;
    try {
      await (new ExtensionManager() as any).unzipFile(zipPath, outputPath);
    } catch (e) {
      error = e as Error;
    }

    expect(error?.message).to.contain('Invalid zip entry path');
    expect(fs.existsSync(path.join(testRoot, 'outside.txt'))).to.be.false;
    expect(fs.existsSync(path.join(outputPath, '__temp_unzip'))).to.be.false;
  });
});
