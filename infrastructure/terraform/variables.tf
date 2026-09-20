variable "prefix" {
  type        = string
  description = "Prefix for all Azure resources"
  default     = "aisre"
}

variable "environment" {
  type        = string
  description = "Deployment environment (dev, staging, prod)"
  default     = "prod"
}

variable "location" {
  type        = string
  description = "Azure European Region for DORA/NIS2/data residency compliance"
  default     = "westeurope"
}

variable "aks_vm_size" {
  type        = string
  description = "VM SKU for AKS worker nodes (Standard_B2s fits within Azure student quotas)"
  default     = "Standard_B2s"
}

variable "aks_node_count" {
  type        = number
  description = "Number of worker nodes in default node pool"
  default     = 2
}

variable "postgres_sku" {
  type        = string
  description = "SKU for Azure Database for PostgreSQL Flexible Server"
  default     = "B_Standard_B1ms"
}

variable "enable_immutable_storage" {
  type        = bool
  description = "Enable WORM/immutable storage for tamper-evident audit ledger"
  default     = true
}
