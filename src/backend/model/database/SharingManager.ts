import {UpdateSharingDTO} from '../../../common/entities/SharingDTO';
import {SQLConnection} from './SQLConnection';
import {SharingEntity} from './enitites/SharingEntity';
import {Config} from '../../../common/config/private/Config';
import {PasswordHelper} from '../PasswordHelper';
import {DeleteResult, SelectQueryBuilder} from 'typeorm';
import {UserDTO} from '../../../common/entities/UserDTO';
import {SearchQueryDTO} from '../../../common/entities/SearchQueryDTO';
import {SearchQueryUtils} from '../../../common/SearchQueryUtils';
import {UserEntity} from './enitites/UserEntity';

export class SharingManager {
  private static async resolveCreator(user?: UserDTO): Promise<UserEntity> {
    const connection = await SQLConnection.getConnection();
    const userRepository = connection.getRepository(UserEntity);
    let creator: UserEntity = null;

    if (user?.id != null) {
      creator = await userRepository.findOneBy({id: user.id});
    }
    if (!creator && user?.name) {
      creator = await userRepository.findOneBy({name: user.name});
    }
    if (!creator) {
      throw new Error('Sharing creator user does not exist');
    }
    return creator;
  }

  private static async removeExpiredLink(): Promise<DeleteResult> {
    const connection = await SQLConnection.getConnection();
    return await connection
      .getRepository(SharingEntity)
      .createQueryBuilder('share')
      .where('expires < :now', {now: Date.now()})
      .delete()
      .execute();
  }

  async deleteSharing(sharingKey: string): Promise<void> {
    const connection = await SQLConnection.getConnection();
    const sharing = await connection
      .getRepository(SharingEntity)
      .findOneBy({sharingKey});
    await connection.getRepository(SharingEntity).remove(sharing);
  }

  async listAll(): Promise<SharingEntity[]> {
    await SharingManager.removeExpiredLink();
    const connection = await SQLConnection.getConnection();
    return await connection
      .getRepository(SharingEntity)
      .createQueryBuilder('share')
      .leftJoinAndSelect('share.creator', 'creator')
      .getMany();
  }


  async listAllForQuery(query: SearchQueryDTO, user?: UserDTO): Promise<SharingEntity[]> {
    await SharingManager.removeExpiredLink();
    const connection = await SQLConnection.getConnection();
    const q: SelectQueryBuilder<SharingEntity> = connection
      .getRepository(SharingEntity)
      .createQueryBuilder('share')
      .leftJoinAndSelect('share.creator', 'creator')
      .where('share.searchQuery = :query', {query: SearchQueryUtils.stringifyForComparison(query)});
    if (user) {
      q.andWhere('share.creator = :user', {user: user.id});
    }
    return await q.getMany();
  }

  async findOne(sharingKey: string): Promise<SharingEntity> {
    await SharingManager.removeExpiredLink();
    const connection = await SQLConnection.getConnection();
    return await connection.getRepository(SharingEntity)
      .createQueryBuilder('share')
      .leftJoinAndSelect('share.creator', 'creator')
      .where('share.sharingKey = :sharingKey', {sharingKey})
      .getOne();
  }

  async createSharing(sharing: UpdateSharingDTO): Promise<SharingEntity> {
    await SharingManager.removeExpiredLink();
    const connection = await SQLConnection.getConnection();
    sharing.creator = await SharingManager.resolveCreator(sharing.creator);
    if (sharing.password) {
      sharing.password = PasswordHelper.cryptPassword(sharing.password);
    }
    if (sharing.searchQuery) {
      SearchQueryUtils.validateSearchQuery(sharing.searchQuery);
      sharing.searchQuery = SearchQueryUtils.sortQuery(sharing.searchQuery);
    }
    if (sharing.defaultSearchView) {
      SearchQueryUtils.validateSearchQuery(sharing.defaultSearchView);
      sharing.defaultSearchView = SearchQueryUtils.sortQuery(sharing.defaultSearchView);
    }
    return connection.getRepository(SharingEntity).save(sharing);
  }

  async updateSharing(
    inSharing: UpdateSharingDTO,
    forceUpdate: boolean
  ): Promise<SharingEntity> {
    const connection = await SQLConnection.getConnection();

    const creator = await SharingManager.resolveCreator(inSharing.creator);
    const sharing = await connection.getRepository(SharingEntity).findOneBy({
      id: inSharing.id,
      creator: creator.id as unknown,
    });

    if (!sharing) {
      throw new Error('Sharing link not found for current user');
    }

    if (
      sharing.timeStamp < Date.now() - Config.Sharing.updateTimeout &&
      forceUpdate !== true
    ) {
      throw new Error('Sharing is locked, can\'t update anymore');
    }
    if (typeof inSharing.password === 'undefined') {
      // Keep the current password when metadata-only admin edits omit the password field.
    } else if (inSharing.password == null) {
      sharing.password = null;
    } else {
      sharing.password = PasswordHelper.cryptPassword(inSharing.password);
    }
    // allow updating searchQuery and canonicalize it
    sharing.searchQuery = SearchQueryUtils.sortQuery(inSharing.searchQuery);
    if (inSharing.defaultSearchView) {
      SearchQueryUtils.validateSearchQuery(inSharing.defaultSearchView);
      sharing.defaultSearchView = SearchQueryUtils.sortQuery(inSharing.defaultSearchView);
    }
    if(inSharing.defaultDirectoryView){
      sharing.defaultDirectoryView = inSharing.defaultDirectoryView;
    }
    sharing.expires = inSharing.expires;

    return connection.getRepository(SharingEntity).save(sharing);
  }
}
