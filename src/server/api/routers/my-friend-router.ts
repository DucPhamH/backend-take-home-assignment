import type { Database } from '@/server/db'

import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { FriendshipStatusSchema } from '@/utils/server/friendship-schemas'
import { protectedProcedure } from '@/server/trpc/procedures'
import { router } from '@/server/trpc/router'
import {
  NonEmptyStringSchema,
  CountSchema,
  IdSchema,
} from '@/utils/server/base-schemas'

export const myFriendRouter = router({
  getById: protectedProcedure
    .input(
      z.object({
        friendUserId: IdSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.connection().execute(async (conn) =>
        /**
         * Question 4: Implement mutual friend count
         *
         * Add `mutualFriendCount` to the returned result of this query. You can
         * either:
         *  (1) Make a separate query to count the number of mutual friends,
         *  then combine the result with the result of this query
         *  (2) BONUS: Use a subquery (hint: take a look at how
         *  `totalFriendCount` is implemented)
         *
         * Instructions:
         *  - Go to src/server/tests/friendship-request.test.ts, enable the test
         * scenario for Question 3
         *  - Run `yarn test` to verify your answer
         *
         * Documentation references:
         *  - https://kysely-org.github.io/kysely/classes/SelectQueryBuilder.html#innerJoin
         */
        conn
          .selectFrom('users as friends')
          .innerJoin('friendships', 'friendships.friendUserId', 'friends.id')
          .innerJoin(
            userTotalFriendCount(conn).as('userTotalFriendCount'),
            'userTotalFriendCount.userId',
            'friends.id'
          )
          /**
           * full join dùng để lấy ra tất cả các bản ghi của bảng bên trái và bảng bên phải
           * khi hai người dùng không có bạn chung thì mutualFriendCount sẽ là null tránh gây ra lỗi khi parse
           * khi dùng inner join thì sẽ không lấy ra các bản ghi không có bạn chung và sẽ dẫn đến lỗi khi parse
           */
          .fullJoin(
            userMutualFriendCount(
              conn,
              ctx.session.userId,
              input.friendUserId
            ).as('userMutualFriendCount'),
            'userMutualFriendCount.userId',
            'friends.id'
          )
          .where('friendships.userId', '=', ctx.session.userId)
          .where('friendships.friendUserId', '=', input.friendUserId)
          .where(
            'friendships.status',
            '=',
            FriendshipStatusSchema.Values['accepted']
          )
          .select([
            'friends.id',
            'friends.fullName',
            'friends.phoneNumber',
            'totalFriendCount',
            'mutualFriendCount',
          ])
          .executeTakeFirstOrThrow(() => new TRPCError({ code: 'NOT_FOUND' }))
          .then(
            z.object({
              id: IdSchema,
              fullName: NonEmptyStringSchema,
              phoneNumber: NonEmptyStringSchema,
              totalFriendCount: CountSchema,
              mutualFriendCount: CountSchema,
            }).parse
          )
      )
    }),
})

const userTotalFriendCount = (db: Database) => {
  return db
    .selectFrom('friendships')
    .where('friendships.status', '=', FriendshipStatusSchema.Values['accepted'])
    .select((eb) => [
      'friendships.userId',
      eb.fn.count('friendships.friendUserId').as('totalFriendCount'),
    ])
    .groupBy('friendships.userId')
}

// const userMutualFriendCount = (
//   db: Database,
//   userId: number,
//   friendId: number
// ) => {
//   return db
//     .selectFrom('friendships as f1')
//     .innerJoin('friendships as f2', 'f2.friendUserId', 'f1.friendUserId')
//     .where('f1.userId', '=', userId)
//     .where('f2.userId', '=', friendId)
//     .where('f1.status', '=', FriendshipStatusSchema.Values['accepted'])
//     .where('f2.status', '=', FriendshipStatusSchema.Values['accepted'])
//     .select((eb) => [
//       'f2.userId',
//       eb.fn.count('f2.friendUserId').as('mutualFriendCount'),
//     ])
//     .groupBy('f2.userId')
// }

const userMutualFriendCount = (
  db: Database,
  userId: number,
  friendId: number
) => {
  const acceptedStatus = FriendshipStatusSchema.Values['accepted']

  const filteredF1 = db
    .selectFrom('friendships')
    .select(['friendUserId'])
    .where('userId', '=', userId)
    .where('status', '=', acceptedStatus)
    .as('f1')

  const filteredF2 = db
    .selectFrom('friendships')
    .select(['friendUserId', 'userId'])
    .where('userId', '=', friendId)
    .where('status', '=', acceptedStatus)
    .as('f2')

  return db
    .selectFrom(filteredF1)
    .innerJoin(filteredF2, 'f2.friendUserId', 'f1.friendUserId')
    .select((eb) => [
      'f2.userId',
      eb.fn.count('f2.friendUserId').as('mutualFriendCount'),
    ])
    .groupBy('f2.userId')
}
