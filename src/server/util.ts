import { PrismaClient } from '@prisma/client';
import { Migrate } from '@prisma/migrate/dist/Migrate';
import { ensureDatabaseExists } from '@prisma/migrate/dist/utils/ensureDatabaseExists';
import { ServerResponse } from 'http';
import { Datasource } from '../lib/datasources';
import Logger from '../lib/logger';
import { bytesToHuman } from '../lib/utils/bytes';

export async function migrations() {
  const logger = Logger.get('database::migrations');

  try {
    logger.debug('establishing database connection');
    const migrate = new Migrate('./prisma/schema.prisma');

    logger.debug('ensuring database exists, if not creating database - may error if no permissions');
    await ensureDatabaseExists('apply', true, './prisma/schema.prisma');

    const diagnose = await migrate.diagnoseMigrationHistory({
      optInToShadowDatabase: false,
    });

    if (diagnose.history?.diagnostic === 'databaseIsBehind') {
      logger.debug('database is behind, attempting to migrate');
      try {
        logger.debug('migrating database');
        await migrate.applyMigrations();
      } finally {
        migrate.stop();
        logger.info('finished migrating database');
      }
    } else {
      logger.debug('exiting migrations engine - database is up to date');
      migrate.stop();
    }
  } catch (error) {
    if (error.message.startsWith('P1001')) {
      logger.error(
        `Unable to connect to database \`${process.env.DATABASE_URL}\`, check your database connection`
      );
    } else {
      logger.error('Failed to migrate database... exiting...');
      logger.error(error);
    }

    process.exit(1);
  }
}

export function log(url: string) {
  if (url.startsWith('/_next') || url.startsWith('/__nextjs')) return;
  return Logger.get('url').info(url);
}

export function redirect(res: ServerResponse, url: string) {
  res.writeHead(307, { Location: url });
  res.end();
}

export async function getStats(prisma: PrismaClient, datasource: Datasource) {
  const size = await datasource.fullSize();
  const byUser = await prisma.image.groupBy({
    by: ['userId'],
    _count: {
      _all: true,
    },
  });
  const count_users = await prisma.user.count();

  const count_by_user = [];
  for (let i = 0, L = byUser.length; i !== L; ++i) {
    const user = await prisma.user.findFirst({
      where: {
        id: byUser[i].userId,
      },
    });

    count_by_user.push({
      username: user.username,
      count: byUser[i]._count._all,
    });
  }

  const count = await prisma.image.count();

  const views = await prisma.image.aggregate({
    _sum: {
      views: true,
    },
  });

  const typesCount = await prisma.image.groupBy({
    by: ['mimetype'],
    _count: {
      mimetype: true,
    },
  });
  const types_count = [];
  for (let i = 0, L = typesCount.length; i !== L; ++i)
    types_count.push({
      mimetype: typesCount[i].mimetype,
      count: typesCount[i]._count.mimetype,
    });

  return {
    size: bytesToHuman(size),
    size_num: size,
    count,
    count_by_user: count_by_user.sort((a, b) => b.count - a.count),
    count_users,
    views_count: views?._sum?.views ?? 0,
    types_count: types_count.sort((a, b) => b.count - a.count),
  };
}
