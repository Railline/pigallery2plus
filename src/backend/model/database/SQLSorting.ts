import {SelectQueryBuilder} from 'typeorm';
import {Config} from '../../../common/config/private/Config';
import {DatabaseType} from '../../../common/config/private/PrivateConfig';

type SortDirection = 'ASC' | 'DESC';

export class SQLSorting {
  public static addNaturalNameOrder<T>(
    query: SelectQueryBuilder<T>,
    mediaAlias = 'media',
    direction: SortDirection
  ): void {
    const name = mediaAlias + '.name';
    const digitChars = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

    if (Config.Database.type === DatabaseType.mysql) {
      const digitPos = 'NULLIF(LEAST(' + digitChars
        .map(d => 'IF(LOCATE(\'' + d + '\', ' + name + ') > 0, LOCATE(\'' + d + '\', ' + name + '), 1000000)')
        .join(', ') + '), 1000000)';
      const pagePos = 'LOCATE(\'_p\', ' + name + ')';
      const prefix = 'LOWER(CASE WHEN ' + pagePos + ' > 0 THEN SUBSTRING(' + name + ', 1, ' + pagePos + ' + 1) ' +
        'WHEN ' + digitPos + ' IS NOT NULL THEN SUBSTRING(' + name + ', 1, ' + digitPos + ' - 1) ELSE ' + name + ' END)';
      const number = 'CAST(CASE WHEN ' + pagePos + ' > 0 THEN SUBSTRING(' + name + ', ' + pagePos + ' + 2) ' +
        'WHEN ' + digitPos + ' IS NOT NULL THEN SUBSTRING(' + name + ', ' + digitPos + ') ELSE \'-1\' END AS UNSIGNED)';

      query
        .addOrderBy(prefix, direction)
        .addOrderBy(number, direction)
        .addOrderBy('LOWER(' + name + ')', direction);
      return;
    }

    const digitPos = 'NULLIF(MIN(' + digitChars
      .map(d => 'CASE WHEN INSTR(' + name + ', \'' + d + '\') > 0 THEN INSTR(' + name + ', \'' + d + '\') ELSE 1000000 END')
      .join(', ') + '), 1000000)';
    const pagePos = 'INSTR(' + name + ', \'_p\')';
    const prefix = 'LOWER(CASE WHEN ' + pagePos + ' > 0 THEN SUBSTR(' + name + ', 1, ' + pagePos + ' + 1) ' +
      'WHEN ' + digitPos + ' IS NOT NULL THEN SUBSTR(' + name + ', 1, ' + digitPos + ' - 1) ELSE ' + name + ' END)';
    const number = 'CAST(CASE WHEN ' + pagePos + ' > 0 THEN SUBSTR(' + name + ', ' + pagePos + ' + 2) ' +
      'WHEN ' + digitPos + ' IS NOT NULL THEN SUBSTR(' + name + ', ' + digitPos + ') ELSE \'-1\' END AS INTEGER)';

    query
      .addOrderBy(prefix, direction)
      .addOrderBy(number, direction)
      .addOrderBy('LOWER(' + name + ')', direction);
  }
}
