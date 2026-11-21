// A WSDL 1.1 document with one service, a SOAP 1.1 port and a SOAP 1.2 port, two operations each (slice 12).
export const BILLING = `<?xml version="1.0" encoding="UTF-8"?>
<definitions name="BillingService" targetNamespace="http://example.com/billing"
  xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
  xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/"
  xmlns:tns="http://example.com/billing" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <types><xsd:schema targetNamespace="http://example.com/billing">
    <xsd:element name="CreateInvoice"><xsd:complexType><xsd:sequence>
      <xsd:element name="customerId" type="xsd:string"/><xsd:element name="amount" type="xsd:decimal"/>
    </xsd:sequence></xsd:complexType></xsd:element>
    <xsd:element name="GetInvoice"><xsd:complexType><xsd:sequence><xsd:element name="id" type="xsd:string"/></xsd:sequence></xsd:complexType></xsd:element>
  </xsd:schema></types>
  <message name="CreateInvoiceIn"><part name="parameters" element="tns:CreateInvoice"/></message>
  <message name="GetInvoiceIn"><part name="parameters" element="tns:GetInvoice"/></message>
  <portType name="BillingPortType">
    <operation name="CreateInvoice"><input message="tns:CreateInvoiceIn"/></operation>
    <operation name="GetInvoice"><input message="tns:GetInvoiceIn"/></operation>
  </portType>
  <binding name="BillingBinding" type="tns:BillingPortType">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="CreateInvoice"><soap:operation soapAction="urn:CreateInvoice"/></operation>
    <operation name="GetInvoice"><soap:operation soapAction="urn:GetInvoice"/></operation>
  </binding>
  <binding name="BillingBinding12" type="tns:BillingPortType">
    <soap12:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="CreateInvoice"><soap12:operation soapAction="urn:CreateInvoice"/></operation>
    <operation name="GetInvoice"><soap12:operation soapAction="urn:GetInvoice"/></operation>
  </binding>
  <service name="BillingService">
    <port name="BillingPort" binding="tns:BillingBinding"><soap:address location="http://localhost:8080/billing"/></port>
    <port name="BillingPort12" binding="tns:BillingBinding12"><soap12:address location="http://localhost:8080/billing12"/></port>
  </service>
</definitions>`;
