import { useQuery } from '@tanstack/react-query';
import { userApi } from '../api/move';

/** Signed-in user; every user-scoped request derives its user_id from here. */
export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: userApi.me, staleTime: 5 * 60_000, retry: 1 });
}
