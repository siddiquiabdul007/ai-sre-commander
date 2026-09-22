output "resource_group_name" {
  value       = azurerm_resource_group.sre_rg.name
  description = "Name of the Azure Resource Group"
}

output "aks_cluster_name" {
  value       = azurerm_kubernetes_cluster.aks.name
  description = "AKS Cluster name"
}

output "acr_login_server" {
  value       = azurerm_container_registry.acr.login_server
  description = "ACR login server URL"
}

output "key_vault_uri" {
  value       = azurerm_key_vault.kv.vault_uri
  description = "Azure Key Vault URI"
}

output "storage_account_name" {
  value       = azurerm_storage_account.sa.name
  description = "Storage account holding immutable audit evidence"
}

output "postgres_fqdn" {
  value       = azurerm_postgresql_flexible_server.pg.fqdn
  description = "PostgreSQL Flexible Server FQDN"
}

output "postgres_database_url" {
  value       = "postgresql://sreadmin:${random_password.pg_admin.result}@${azurerm_postgresql_flexible_server.pg.fqdn}:5432/sre_commander?sslmode=require"
  description = "Full PostgreSQL connection string"
  sensitive   = true
}


output "aks_kube_config" {
  value       = azurerm_kubernetes_cluster.aks.kube_config_raw
  description = "AKS kubeconfig for kubectl access"
  sensitive   = true
}
