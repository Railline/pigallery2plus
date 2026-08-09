import {expect} from 'chai';
import * as path from 'path';
import {RenderingMWs} from '../../../../src/backend/middlewares/RenderingMWs';
import {ProjectPath} from '../../../../src/backend/ProjectPath';
import {ErrorCodes, ErrorDTO} from '../../../../src/common/entities/Error';

describe('RenderingMWs', () => {
  it('rejects files outside the configured media and temporary roots', async () => {
    const originalImageFolder = ProjectPath.ImageFolder;
    const originalTempFolder = ProjectPath.TempFolder;
    ProjectPath.ImageFolder = path.join(__dirname, 'media');
    ProjectPath.TempFolder = path.join(__dirname, 'temp');
    let nextValue: unknown;

    try {
      await RenderingMWs.renderFile(
        {
          resultPipe: path.join(__dirname, 'media-evil', 'secret.jpg'),
          params: {},
        } as any,
        {} as any,
        ((value?: unknown): void => {
          nextValue = value;
        }) as any
      );
    } finally {
      ProjectPath.ImageFolder = originalImageFolder;
      ProjectPath.TempFolder = originalTempFolder;
    }

    expect(nextValue).to.be.instanceOf(ErrorDTO);
    expect((nextValue as ErrorDTO).code).to.equal(ErrorCodes.PATH_ERROR);
  });

  it('serves a derived file relative to the trusted temporary root', async () => {
    const originalImageFolder = ProjectPath.ImageFolder;
    const originalTempFolder = ProjectPath.TempFolder;
    ProjectPath.ImageFolder = path.join(__dirname, 'media');
    ProjectPath.TempFolder = path.join(__dirname, 'temp');
    const filePath = path.join(ProjectPath.TempFolder, 'tc', 'nested', 'photo.webp');
    let sentPath: string;
    let sentOptions: {root?: string};
    const response = {
      hasHeader: (): boolean => false,
      setHeader: (): any => response,
      sendFile: (value: string, options: {root?: string}): any => {
        sentPath = value;
        sentOptions = options;
        return response;
      },
    } as any;

    try {
      await RenderingMWs.renderFile(
        {resultPipe: filePath, params: {}} as any,
        response,
        ((): void => undefined) as any
      );
    } finally {
      ProjectPath.ImageFolder = originalImageFolder;
      ProjectPath.TempFolder = originalTempFolder;
    }

    expect(sentPath).to.equal(path.join('tc', 'nested', 'photo.webp'));
    expect(sentOptions.root).to.equal(path.resolve(path.join(__dirname, 'temp')));
  });
});
