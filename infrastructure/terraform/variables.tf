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
  description = "Azure Region (centralindia allowed by student subscription policy)"
  default     = "centralindia"
}

variable "aks_vm_size" {
  type        = string
  description = "VM SKU for AKS worker nodes (Standard_B2s_v2 available in centralindia under student quota)"
  default     = "Standard_B2s_v2"
}

variable "aks_node_count" {
  type        = number
  description = "Number of worker nodes in default node pool"
  default     = 1
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

variable "developer_ip" {
  type        = string
  description = "Developer machine IP address for PostgreSQL firewall allow-list. No default — must be set explicitly to prevent accidental wide-open access."
  sensitive   = true
}
