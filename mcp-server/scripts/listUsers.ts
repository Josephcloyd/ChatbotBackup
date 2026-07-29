import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("Supabase config missing");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function main() {
  const operatorUserId = "60abc7c7-0d42-43bf-8ddc-424252282985";
  const loginEmail = "operator1@lifewood.local";
  const username = "operator1";
  const displayName = "wilfredalternate6969@gmail.com";

  console.log("Updating Auth user login email and display name...");
  const { data: user, error: authError } = await supabase.auth.admin.updateUserById(
    operatorUserId,
    {
      email: loginEmail,
      user_metadata: {
        role: "user",
        display_name: displayName,
        active: true
      }
    }
  );

  if (authError) {
    console.error("Error updating Auth user:", authError);
    process.exit(1);
  }

  console.log("Auth user updated successfully:", user);

  console.log("Restoring production_plans owner username...");
  const { data: plans, error: plansError } = await supabase
    .from("production_plans")
    .update({ whatsapp_user_id: username })
    .eq("whatsapp_user_id", displayName)
    .select();

  if (plansError) {
    console.error("Error updating production_plans:", plansError);
    process.exit(1);
  }

  console.log("Production plans updated successfully:", plans);
}

main().catch(console.error);
