import {SubDirectoryDTO} from './DirectoryDTO';
import {FileDTO} from './FileDTO';
import {MediaDTO} from './MediaDTO';
import {SearchQueryDTO} from './SearchQueryDTO';
import {DirectoryMediaPageDTO} from './DirectoryDTO';

export interface SearchResultDTO {
  searchQuery: SearchQueryDTO;
  directories: SubDirectoryDTO[];
  media: MediaDTO[];
  metaFile: FileDTO[];
  resultOverflow: boolean;
  mediaPage?: DirectoryMediaPageDTO;
}
