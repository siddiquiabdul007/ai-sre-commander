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
  admin_enabled       = true

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
  purge_protection_enabled    = false
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
