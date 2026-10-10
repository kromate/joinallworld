import type { Component } from 'vue'

type BodyModule = { default: Component }

// Only component loaders live here. Registry metadata, HUD and identity gates remain eager.
const loaders = {
  'bank/BankApp': () => import('../features/bank/BankApp.vue'),
  'messages/MessagesApp': () => import('../features/messages/MessagesApp.vue'),
  'support/ReportApp': () => import('../features/support/ReportApp.vue'),
  'jobs/JobsApp': () => import('../features/jobs/JobsApp.vue'),
  'jobs/CareerTab': () => import('../features/jobs/CareerTab.vue'),
  'money/StatementApp': () => import('../features/money/StatementApp.vue'),
  'money/InvestApp': () => import('../features/money/InvestApp.vue'),
  'home/HousesApp': () => import('../features/home/HousesApp.vue'),
  'neighbourhood/LandPanel': () => import('../features/neighbourhood/LandPanel.vue'),
  'neighbourhood/NeighbourhoodPanel': () => import('../features/neighbourhood/NeighbourhoodPanel.vue'),
  'stories/StoriesApp': () => import('../features/stories/StoriesApp.vue'),
  'capture/CaptureApp': () => import('../features/capture/CaptureApp.vue'),
  'home/CarsApp': () => import('../features/home/CarsApp.vue'),
  'home/GroceriesApp': () => import('../features/home/GroceriesApp.vue'),
  'life/HealthApp': () => import('../features/life/HealthApp.vue'),
  'life/GoalsTab': () => import('../features/life/GoalsTab.vue'),
  'sim/ProfileTab': () => import('../features/sim/ProfileTab.vue'),
  'sim/NeedsTab': () => import('../features/sim/NeedsTab.vue'),
  'sim/SkillsTab': () => import('../features/sim/SkillsTab.vue'),
  'sim/SettingsTab': () => import('../features/sim/SettingsTab.vue'),
  'life/BoutiqueApp': () => import('../features/life/BoutiqueApp.vue'),
  'home/BuyMode': () => import('../features/home/BuyMode.vue'),
  'account/AccountSignIn': () => import('../features/account/AccountSignIn.vue'),
  'admin/AdminApp': () => import('../features/admin/AdminApp.vue'),
  'business/BusinessApp': () => import('../features/business/BusinessApp.vue'),
  'showcase/ShowcaseApp': () => import('../features/showcase/ShowcaseApp.vue'),
  'campus/CampusApp': () => import('../features/campus/CampusApp.vue'),
  'civic/GovernorApp': () => import('../features/civic/GovernorApp.vue'),
  'civic/StateHouseSheet': () => import('../features/civic/StateHouseSheet.vue'),
  'civic/NeighboursApp': () => import('../features/civic/NeighboursApp.vue'),
  'civic/AdsApp': () => import('../features/civic/AdsApp.vue'),
  'civic/HuntSheet': () => import('../features/civic/HuntSheet.vue'),
  'civic/RadioApp': () => import('../features/civic/RadioApp.vue'),
  'civic/RichListApp': () => import('../features/civic/RichListApp.vue'),
  'commerce/CommerceApp': () => import('../features/commerce/CommerceApp.vue'),
  'games/GamesApp': () => import('../features/games/GamesApp.vue'),
  'growth/MissionsApp': () => import('../features/growth/MissionsApp.vue'),
  'growth/EventsApp': () => import('../features/growth/EventsApp.vue'),
  'growth/ReferApp': () => import('../features/growth/ReferApp.vue'),
  'growth/TouchApp': () => import('../features/growth/TouchApp.vue'),
  'growth/ShareSheet': () => import('../features/growth/ShareSheet.vue'),
  'living-world/PracticeGateway': () => import('../features/living-world/PracticeGateway.vue'),
  'politics/PoliticsApp': () => import('../features/politics/PoliticsApp.vue'),
  'social/PeopleApp': () => import('../features/social/PeopleApp.vue'),
  'social/PersonApp': () => import('../features/social/PersonApp.vue'),
  'social/ContactsApp': () => import('../features/social/ContactsApp.vue'),
  'social/FamilyApp': () => import('../features/social/FamilyApp.vue'),
  'social/InviteApp': () => import('../features/social/InviteApp.vue'),
  'tables/TablesApp': () => import('../features/tables/TablesApp.vue'),
  'travel/MapApp': () => import('../features/travel/MapApp.vue'),
  'travel/RoadsideModal': () => import('../features/travel/RoadsideModal.vue'),
  'travel/RideApp': () => import('../features/travel/RideApp.vue'),
  'travel/CityPanel': () => import('../features/travel/CityPanel.vue'),
  'travel/VisitorHome': () => import('../features/travel/VisitorHome.vue'),
  'world/WorldLgaPanel': () => import('../features/world/WorldLgaPanel.vue'),
  'world/HouseCard': () => import('../features/world/HouseCard.vue'),
} satisfies Record<string, () => Promise<BodyModule>>

export type PanelBody = keyof typeof loaders

export function loadPanelBody(key: PanelBody): Promise<Component> {
  return loaders[key]().then((module) => module.default)
}
