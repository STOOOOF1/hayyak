import { createClient } from "@/lib/supabase/server";

type RpcResult<T> = T[] | null;

export type EnqueuedCall = {
  call_id: string;
  tenant_id: string;
  branch_id: string;
  queue_sequence: number;
  status: string;
  queue_position: number;
};

export type CurrentCall = {
  call_id: string;
  status: string;
  queue_sequence: number;
  queue_position: number;
  branch_id: string;
  tenant_id: string;
};

export type QueueCommand = {
  call_id: string;
  status: string;
};

function first<T>(result: RpcResult<T>): T | undefined {
  return Array.isArray(result) ? result[0] : undefined;
}

async function expectEmpty(result: { error: unknown }, fallbackMessage: string) {
  if (result.error) {
    throw new Error(fallbackMessage);
  }
}

export async function enqueueCall(
  branchSlug: string,
  visitorIdentifier: string,
  carDescription: string | null,
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("enqueue_call", {
    p_branch_slug: branchSlug,
    p_visitor_identifier: visitorIdentifier,
    p_car_description: carDescription,
  });

  if (error) {
    throw new Error("تعذر الانضمام إلى الطابور، حاول مرة أخرى.");
  }

  return first(data as RpcResult<EnqueuedCall>);
}

export async function getCustomerCurrentCall(
  branchSlug: string,
  visitorIdentifier: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_customer_current_call", {
    p_branch_slug: branchSlug,
    p_visitor_identifier: visitorIdentifier,
  });

  if (error) {
    throw new Error("تعذر قراءة حالة الطلب.");
  }

  return first(data as RpcResult<CurrentCall>);
}

export async function cancelWaitingCall(
  branchId: string,
  callId: string,
  visitorIdentifier: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_waiting_call", {
    p_branch_id: branchId,
    p_call_id: callId,
    p_visitor_identifier: visitorIdentifier,
  });

  if (error) {
    throw new Error("تعذر إلغاء الطلب.");
  }

  return first(data as RpcResult<QueueCommand>);
}

export async function updateCarDescriptionAsVisitor(
  branchId: string,
  callId: string,
  carDescription: string,
  visitorIdentifier: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_car_description", {
    p_branch_id: branchId,
    p_call_id: callId,
    p_car_description: carDescription,
    p_visitor_identifier: visitorIdentifier,
  });

  if (error) {
    throw new Error("تعذر تحديث وصف المركبة.");
  }

  return first(data as RpcResult<{ call_id: string; car_description: string }>);
}

export async function answerCall(
  branchId: string,
  callId: string,
  actorUserId: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("answer_call", {
    p_branch_id: branchId,
    p_call_id: callId,
    p_actor_user_id: actorUserId,
  });
  await expectEmpty({ error }, "تعذر قبول المتصل.");
  return first(data as RpcResult<QueueCommand>);
}

export async function holdCall(
  branchId: string,
  callId: string,
  actorUserId: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("hold_call", {
    p_branch_id: branchId,
    p_call_id: callId,
    p_actor_user_id: actorUserId,
  });
  await expectEmpty({ error }, "تعذر تعليق المتصل.");
  return first(data as RpcResult<QueueCommand>);
}

export async function holdAndAnswerNext(
  branchId: string,
  activeCallId: string,
  actorUserId: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("hold_and_answer_next", {
    p_branch_id: branchId,
    p_active_call_id: activeCallId,
    p_actor_user_id: actorUserId,
  });
  await expectEmpty({ error }, "تعذر نقل المكالمة التالية.");
  return first(
    data as RpcResult<{
      held_call_id: string;
      answered_call_id: string | null;
      status_held: string;
      status_answered: string;
    }>,
  );
}

export async function resumeCall(
  branchId: string,
  callId: string,
  actorUserId: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resume_call", {
    p_branch_id: branchId,
    p_call_id: callId,
    p_actor_user_id: actorUserId,
  });
  await expectEmpty({ error }, "تعذر استئناف المكالمة.");
  return first(data as RpcResult<QueueCommand>);
}

export async function endCall(
  branchId: string,
  callId: string,
  actorUserId: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("end_call", {
    p_branch_id: branchId,
    p_call_id: callId,
    p_actor_user_id: actorUserId,
  });
  await expectEmpty({ error }, "تعذر إنهاء المكالمة.");
  return first(data as RpcResult<QueueCommand>);
}
