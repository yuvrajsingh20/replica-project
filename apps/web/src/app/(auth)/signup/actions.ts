'use server';

import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server.js';

export async function signupAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const workspaceName = String(formData.get('workspaceName') ?? '').trim();
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: workspaceName ? { workspace_name: workspaceName } : {},
    },
  });
  if (error) {
    throw new Error(error.message);
  }
  redirect('/app/rules');
}
