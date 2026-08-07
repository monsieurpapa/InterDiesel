import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import { Layout } from "./components/Layout";
import { CrudPage } from "./components/CrudPage";
import { ModuleGate } from "./components/ModuleGate";
import { Dashboard } from "./pages/Dashboard";
import { Factures } from "./pages/Factures";
import { Login } from "./pages/Login";
import { ChangePassword } from "./pages/ChangePassword";
import { Utilisateurs } from "./pages/Utilisateurs";
import { FacturePrint } from "./pages/FacturePrint";
import {
  clientsFields,
  servicesFields,
  tarifsTransportFields,
  contratsLocationFields,
  vehiculesFields,
  distributeursFields,
  operationsDistributionFields,
  facturesARembourserFields,
  employesFields,
  depensesPersonnelFields,
  depensesFonctionnementFields,
  mouvementsCaisseFields,
} from "./config/resources";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/connexion" element={<Login />} />

          <Route element={<RequireAuth />}>
            <Route path="/changer-mot-de-passe" element={<ChangePassword />} />
            <Route path="/factures/:id/imprimer" element={<FacturePrint />} />

            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route
                path="/clients"
                element={
                  <ModuleGate module="facturation">
                    <CrudPage resource="clients" title="Clients" fields={clientsFields} />
                  </ModuleGate>
                }
              />
              <Route
                path="/services"
                element={
                  <ModuleGate module="facturation">
                    <CrudPage resource="services" title="Services & produits" fields={servicesFields} />
                  </ModuleGate>
                }
              />
              <Route
                path="/factures"
                element={
                  <ModuleGate module="facturation">
                    <Factures />
                  </ModuleGate>
                }
              />
              <Route
                path="/factures-a-rembourser"
                element={
                  <ModuleGate module="facturation">
                    <CrudPage
                      resource="factures-a-rembourser"
                      title="Factures à rembourser / notes de frais"
                      fields={facturesARembourserFields}
                    />
                  </ModuleGate>
                }
              />
              <Route
                path="/tarifs-transport"
                element={
                  <ModuleGate module="transport">
                    <CrudPage
                      resource="tarifs-transport"
                      title="Grille tarifaire transport"
                      fields={tarifsTransportFields}
                    />
                  </ModuleGate>
                }
              />
              <Route
                path="/contrats-location"
                element={
                  <ModuleGate module="locations">
                    <CrudPage
                      resource="contrats-location"
                      title="Contrats de location (entrepôt / véhicule)"
                      fields={contratsLocationFields}
                    />
                  </ModuleGate>
                }
              />
              <Route
                path="/vehicules"
                element={
                  <ModuleGate module="locations">
                    <CrudPage resource="vehicules" title="Véhicules" fields={vehiculesFields} />
                  </ModuleGate>
                }
              />
              <Route
                path="/distributeurs"
                element={
                  <ModuleGate module="distribution">
                    <CrudPage resource="distributeurs" title="Distributeurs" fields={distributeursFields} />
                  </ModuleGate>
                }
              />
              <Route
                path="/operations-distribution"
                element={
                  <ModuleGate module="distribution">
                    <CrudPage
                      resource="operations-distribution"
                      title="Journal des opérations de distribution"
                      fields={operationsDistributionFields}
                    />
                  </ModuleGate>
                }
              />
              <Route
                path="/mouvements-caisse"
                element={
                  <ModuleGate module="tresorerie">
                    <CrudPage
                      resource="mouvements-caisse"
                      title="Mouvements de caisse"
                      fields={mouvementsCaisseFields}
                    />
                  </ModuleGate>
                }
              />
              <Route
                path="/employes"
                element={
                  <ModuleGate module="personnel">
                    <CrudPage resource="employes" title="Employés" fields={employesFields} />
                  </ModuleGate>
                }
              />
              <Route
                path="/depenses-personnel"
                element={
                  <ModuleGate module="personnel">
                    <CrudPage
                      resource="depenses-personnel"
                      title="Dépenses de personnel"
                      fields={depensesPersonnelFields}
                    />
                  </ModuleGate>
                }
              />
              <Route
                path="/depenses-fonctionnement"
                element={
                  <ModuleGate module="personnel">
                    <CrudPage
                      resource="depenses-fonctionnement"
                      title="Dépenses de fonctionnement bureau"
                      fields={depensesFonctionnementFields}
                    />
                  </ModuleGate>
                }
              />
              <Route
                path="/utilisateurs"
                element={
                  <ModuleGate module="admin">
                    <Utilisateurs />
                  </ModuleGate>
                }
              />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
