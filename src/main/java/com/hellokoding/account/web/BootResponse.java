package com.hellokoding.account.web;
import java.util.List;

import org.activiti.rest.service.api.identity.GroupResponse;
import org.activiti.rest.service.api.identity.UserResponse;
import org.activiti.rest.service.api.repository.ProcessDefinitionResponse;

public class BootResponse {

  protected String userId;
  protected List<UserResponse> users;
  protected List<GroupResponse> groups;
  protected List<String> memberOf;
  protected List<ProcessDefinitionResponse> processDefinitions;

  public String getUserId() {
    return userId;
  }
  
  public void setUserId(String userId) {
    this.userId = userId;
  }
  
  public List<UserResponse> getUsers() {
    return users;
  }

  public void setUsers(List<UserResponse> users) {
    this.users = users;
  }

  public List<GroupResponse> getGroups() {
    return groups;
  }

  public void setGroups(List<GroupResponse> groups) {
    this.groups = groups;
  }

  public List<String> getMemberOf() {
    return memberOf;
  }

  public void setMemberOf(List<String> memberOf) {
    this.memberOf = memberOf;
  }

  public List<ProcessDefinitionResponse> getProcessDefinitions() {
    return processDefinitions;
  }

  public void setProcessDefinitions(List<ProcessDefinitionResponse> processDefinitions) {
    this.processDefinitions = processDefinitions;
  }

}
