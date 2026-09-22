resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}

# 1. Resource Group
resource "azurerm_resource_group" "sre_rg" {
  name     = "rg-${var.prefix}-${var.environment}-${var.location}"
  location = var.location

  tags = {
    Environment = var.environment
    ManagedBy   = "Terraform"
    Project     = "AI-SRE-Commander"
    Compliance  = "DORA-NIS2-EU-AI-Act"
  }
}

# 2. Log Analytics Workspace for Observability
resource "azurerm_log_analytics_workspace" "sre_logs" {
  name                = "law-${var.prefix}-${var.environment}-${random_string.suffix.result}"
  location            = azurerm_resource_group.sre_rg.location
  resource_group_name = azurerm_resource_group.sre_rg.name
  sku                 = "PerGB2018"
  retention_in_days   = 30

  tags = azurerm_resource_group.sre_rg.tags
}

# 3. Virtual Network & Subnets
resource "azurerm_virtual_network" "sre_vnet" {
  name                = "vnet-${var.prefix}-${var.environment}"
  location            = azurerm_resource_group.sre_rg.location
  resource_group_name = azurerm_resource_group.sre_rg.name
  address_space       = ["10.100.0.0/16"]

  tags = azurerm_resource_group.sre_rg.tags
}

resource "azurerm_subnet" "aks_subnet" {
  name                 = "snet-aks"
  resource_group_name  = azurerm_resource_group.sre_rg.name
  virtual_network_name = azurerm_virtual_network.sre_vnet.name
  address_prefixes     = ["10.100.1.0/24"]
}

# 4. Azure Container Registry (ACR)
resource "azurerm_container_registry" "acr" {
  name                = "acr${var.prefix}${var.environment}${random_string.suffix.result}"
  resource_group_name = azurerm_resource_group.sre_rg.name
  location            = azurerm_resource_group.sre_rg.location
  sku                 = "Basic"
  admin_enabled       = false

  tags = azurerm_resource_group.sre_rg.tags
}

# 5. Azure Kubernetes Service (AKS)
resource "azurerm_kubernetes_cluster" "aks" {
  name                = "aks-${var.prefix}-${var.environment}"
  location            = azurerm_resource_group.sre_rg.location
  resource_group_name = azurerm_resource_group.sre_rg.name
  dns_prefix          = "aks-${var.prefix}-${var.environment}"

  default_node_pool {
    name           = "systempool"
    node_count     = var.aks_node_count
    vm_size        = var.aks_vm_size
    vnet_subnet_id = azurerm_subnet.aks_subnet.id
    os_disk_size_gb = 32
  }

  identity {
    type = "SystemAssigned"
  }

  network_profile {
    network_plugin    = "azure"
    network_policy    = "azure"
    load_balancer_sku = "standard"
  }

  oms_agent {
    log_analytics_workspace_id = azurerm_log_analytics_workspace.sre_logs.id
  }

  tags = azurerm_resource_group.sre_rg.tags
}

# 6. Azure Key Vault (Least-Privilege Secret Management)
data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "kv" {
  name                        = "kv-${var.prefix}-${random_string.suffix.result}"
  location                    = azurerm_resource_group.sre_rg.location
  resource_group_name         = azurerm_resource_group.sre_rg.name
  enabled_for_disk_encryption = true
  tenant_id                   = data.azurerm_client_config.current.tenant_id
  soft_delete_retention_days  = 7
  purge_protection_enabled    = true
  sku_name                    = "standard"

  access_policy {
    tenant_id = data.azurerm_client_config.current.tenant_id
    object_id = data.azurerm_client_config.current.object_id

    secret_permissions = [
      "Get", "List", "Set", "Delete", "Purge"
    ]
  }

  tags = azurerm_resource_group.sre_rg.tags
}

# 7. Azure Storage Account with Immutable WORM Blob Container (PRD §15.2, §29)
resource "azurerm_storage_account" "sa" {
  name                     = "sa${var.prefix}${random_string.suffix.result}"
  resource_group_name      = azurerm_resource_group.sre_rg.name
  location                 = azurerm_resource_group.sre_rg.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"

  blob_properties {
    versioning_enabled = true
  }

  tags = azurerm_resource_group.sre_rg.tags
}

resource "azurerm_storage_container" "audit_evidence" {
  name                  = "audit-evidence-ledger"
  storage_account_name  = azurerm_storage_account.sa.name
  container_access_type = "private"
}

# 8. Subnet for PostgreSQL Flexible Server (delegated)
resource "azurerm_subnet" "postgres_subnet" {
  name                 = "snet-postgres"
  resource_group_name  = azurerm_resource_group.sre_rg.name
  virtual_network_name = azurerm_virtual_network.sre_vnet.name
  address_prefixes     = ["10.100.2.0/24"]
  service_endpoints    = ["Microsoft.Storage"]

  delegation {
    name = "postgres-delegation"
    service_delegation {
      name = "Microsoft.DBforPostgreSQL/flexibleServers"
      actions = [
        "Microsoft.Network/virtualNetworks/subnets/join/action"
      ]
    }
  }
}

# 9a. Cryptographically random database password (PRD v4.0 §A.3)
resource "random_password" "pg_admin" {
  length           = 32
  special          = true
  override_special = "!@#$%"
}

# 9b. Azure Database for PostgreSQL Flexible Server (PRD v2.0 §3.3)
resource "azurerm_postgresql_flexible_server" "pg" {
  name                   = "pg-${var.prefix}-${var.environment}-${random_string.suffix.result}"
  resource_group_name    = azurerm_resource_group.sre_rg.name
  location               = azurerm_resource_group.sre_rg.location
  version                = "16"
  administrator_login    = "sreadmin"
  administrator_password = random_password.pg_admin.result
  storage_mb             = 32768
  sku_name               = var.postgres_sku
  backup_retention_days  = 7
  public_network_access_enabled = true

  tags = azurerm_resource_group.sre_rg.tags
}

# 9c. Scoped firewall rules — PRD v4.0 §A.2: AKS subnet + developer IP only
# CRITICAL: Replaces the previous 0.0.0.0–255.255.255.255 rule that exposed
# the database to the entire internet.
resource "azurerm_postgresql_flexible_server_firewall_rule" "allow_aks_subnet" {
  name             = "allow-aks-subnet"
  server_id        = azurerm_postgresql_flexible_server.pg.id
  start_ip_address = "10.100.1.0"
  end_ip_address   = "10.100.1.255"
}

resource "azurerm_postgresql_flexible_server_firewall_rule" "allow_developer" {
  name             = "allow-developer-ip"
  server_id        = azurerm_postgresql_flexible_server.pg.id
  start_ip_address = var.developer_ip
  end_ip_address   = var.developer_ip
}

resource "azurerm_postgresql_flexible_server_database" "sre_db" {
  name      = "sre_commander"
  server_id = azurerm_postgresql_flexible_server.pg.id
  collation = "en_US.utf8"
  charset   = "utf8"
}

# 12. Attach ACR to AKS (allow AKS to pull images)
resource "azurerm_role_assignment" "aks_acr_pull" {
  principal_id                     = azurerm_kubernetes_cluster.aks.kubelet_identity[0].object_id
  role_definition_name             = "AcrPull"
  scope                            = azurerm_container_registry.acr.id
  skip_service_principal_aad_check = true
}

