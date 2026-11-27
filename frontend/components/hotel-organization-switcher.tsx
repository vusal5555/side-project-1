"use client";

import { OrganizationSwitcher } from "@clerk/nextjs";
import { Building2 } from "lucide-react";
import HotelAccessPanel from "@/components/hotel-access-panel";

// Drop-in replacement for your existing <OrganizationSwitcher />.
// Clerk still handles General, Members, invitations, and organization switching.
export default function HotelOrganizationSwitcher() {
  return (
    <OrganizationSwitcher>
      <OrganizationSwitcher.OrganizationProfilePage
        label="Hotels & Access"
        url="hotel-access"
        labelIcon={<Building2 size={16} />}
      >
        <HotelAccessPanel />
      </OrganizationSwitcher.OrganizationProfilePage>
    </OrganizationSwitcher>
  );
}
